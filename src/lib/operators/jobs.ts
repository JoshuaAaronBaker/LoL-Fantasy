import type { Sql } from "postgres";
import { z } from "zod";

export const stageBootstrapJobPayloadSchema = z.object({
  tournamentId: z.string().min(1),
  stageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  stageName: z.string().trim().min(3).max(80),
  lockAt: z.iso.datetime(),
  teamProviderIds: z.array(z.string().min(1)).min(1),
});

export type StageBootstrapJobPayload = z.infer<typeof stageBootstrapJobPayloadSchema>;

export const stageSyncJobPayloadSchema = z.object({
  scheduleId: z.uuid(),
  stageId: z.uuid(),
  stageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  stageName: z.string().trim().min(3).max(80),
  matchProviderIds: z.array(z.string().min(1)).min(1),
  refreshCompleted: z.boolean(),
});

export type StageSyncJobPayload = z.infer<typeof stageSyncJobPayloadSchema>;
export type OperatorJobType = "STAGE_BOOTSTRAP" | "STAGE_SYNC";
export type OperatorJobPayload = StageBootstrapJobPayload | StageSyncJobPayload;

interface OperatorJobBase {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
}

export type OperatorJobRecord = OperatorJobBase & (
  | { jobType: "STAGE_BOOTSTRAP"; payload: StageBootstrapJobPayload }
  | { jobType: "STAGE_SYNC"; payload: StageSyncJobPayload }
);

function mapJob(row: {
  id: string; job_type: OperatorJobType; status: OperatorJobRecord["status"];
  payload: unknown; attempts: number; max_attempts: number; worker_id: string | null;
  lease_expires_at: string | null;
}): OperatorJobRecord {
  const base = {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
  };
  return row.job_type === "STAGE_BOOTSTRAP"
    ? { ...base, jobType: row.job_type, payload: stageBootstrapJobPayloadSchema.parse(row.payload) }
    : { ...base, jobType: row.job_type, payload: stageSyncJobPayloadSchema.parse(row.payload) };
}

export async function enqueueStageBootstrapJob(
  sql: Sql,
  requestedBy: string,
  payloadInput: StageBootstrapJobPayload,
) {
  const payload = stageBootstrapJobPayloadSchema.parse(payloadInput);
  const idempotencyKey = `stage-bootstrap:${payload.tournamentId}:${payload.stageSlug}`;
  const rows = await sql<Array<{
    id: string; job_type: OperatorJobType; status: OperatorJobRecord["status"];
    payload: unknown; attempts: number; max_attempts: number; worker_id: string | null;
    lease_expires_at: string | null;
  }>>`
    insert into operator_jobs (job_type, payload, idempotency_key, requested_by)
    values ('STAGE_BOOTSTRAP', ${sql.json(payload)}, ${idempotencyKey}, ${requestedBy})
    on conflict (idempotency_key) do update set
      payload = case when operator_jobs.status = 'FAILED' then excluded.payload else operator_jobs.payload end,
      requested_by = case when operator_jobs.status = 'FAILED' then excluded.requested_by else operator_jobs.requested_by end,
      status = case when operator_jobs.status = 'FAILED' then 'QUEUED' else operator_jobs.status end,
      attempts = case when operator_jobs.status = 'FAILED' then 0 else operator_jobs.attempts end,
      worker_id = case when operator_jobs.status = 'FAILED' then null else operator_jobs.worker_id end,
      lease_expires_at = case when operator_jobs.status = 'FAILED' then null else operator_jobs.lease_expires_at end,
      error_message = case when operator_jobs.status = 'FAILED' then null else operator_jobs.error_message end,
      started_at = case when operator_jobs.status = 'FAILED' then null else operator_jobs.started_at end,
      completed_at = case when operator_jobs.status = 'FAILED' then null else operator_jobs.completed_at end
    returning id, job_type, status, payload, attempts, max_attempts, worker_id, lease_expires_at::text
  `;
  return mapJob(rows[0]);
}

export async function claimOperatorJob(
  sql: Sql,
  workerId: string,
  leaseSeconds = 1_800,
  jobTypes: OperatorJobType[] = ["STAGE_BOOTSTRAP", "STAGE_SYNC"],
) {
  if (jobTypes.length === 0) throw new Error("At least one operator job type is required.");
  await sql`
    update operator_jobs set status = 'FAILED', completed_at = clock_timestamp(), lease_expires_at = null,
      error_message = coalesce(error_message, 'Worker lease expired after the maximum number of attempts.')
    where status = 'RUNNING' and lease_expires_at < clock_timestamp() and attempts >= max_attempts
  `;
  const rows = await sql<Array<{
    id: string; job_type: OperatorJobType; status: OperatorJobRecord["status"];
    payload: unknown; attempts: number; max_attempts: number; worker_id: string | null;
    lease_expires_at: string | null;
  }>>`
    with candidate as (
      select id from operator_jobs
      where attempts < max_attempts
        and job_type in ${sql(jobTypes)}
        and (status = 'QUEUED' or (status = 'RUNNING' and lease_expires_at < clock_timestamp()))
      order by created_at
      for update skip locked
      limit 1
    )
    update operator_jobs job set
      status = 'RUNNING', attempts = job.attempts + 1, worker_id = ${workerId},
      lease_expires_at = clock_timestamp() + (${leaseSeconds} * interval '1 second'),
      started_at = coalesce(job.started_at, clock_timestamp()), error_message = null
    from candidate where job.id = candidate.id
    returning job.id, job.job_type, job.status, job.payload, job.attempts, job.max_attempts,
      job.worker_id, job.lease_expires_at::text
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function completeOperatorJob(sql: Sql, jobId: string, workerId: string, result: unknown) {
  const safeResult = JSON.parse(JSON.stringify(result ?? null));
  const rows = await sql<Array<{ id: string }>>`
    update operator_jobs set status = 'SUCCEEDED', result = ${sql.json(safeResult)},
      completed_at = clock_timestamp(), lease_expires_at = null
    where id = ${jobId} and status = 'RUNNING' and worker_id = ${workerId}
    returning id
  `;
  if (!rows[0]) throw new Error(`Worker ${workerId} no longer owns job ${jobId}.`);
}

export async function failOperatorJob(sql: Sql, jobId: string, workerId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const rows = await sql<Array<{ id: string }>>`
    update operator_jobs set status = 'FAILED', error_message = ${message.slice(0, 1000)},
      completed_at = clock_timestamp(), lease_expires_at = null
    where id = ${jobId} and status = 'RUNNING' and worker_id = ${workerId}
    returning id
  `;
  if (!rows[0]) throw new Error(`Worker ${workerId} no longer owns job ${jobId}.`);
}
