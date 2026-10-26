import type { Sql } from "postgres";
import { stageSyncJobPayloadSchema } from "@/lib/operators/jobs";

export interface StageSyncScheduleInput {
  stageId: string;
  intervalMinutes: number;
  matchProviderIds: string[];
  refreshCompleted?: boolean;
}

function uniqueMatchIds(values: string[]) {
  const ids = values.map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("At least one match ID is required.");
  if (new Set(ids).size !== ids.length) throw new Error("Match IDs must be unique.");
  return ids;
}

export async function upsertStageSyncSchedule(
  sql: Sql,
  operatorId: string,
  input: StageSyncScheduleInput,
) {
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 1_440) {
    throw new Error("Sync interval must be between 5 and 1440 minutes.");
  }
  const matchIds = uniqueMatchIds(input.matchProviderIds);
  return sql.begin(async (tx) => {
    const stages = await tx<Array<{ tournament_id: string }>>`
      select tournament_id from tournament_stages where id = ${input.stageId} for update
    `;
    const stage = stages[0];
    if (!stage) throw new Error("Stage synchronization requires an existing stage.");

    const incompatible = await tx<Array<{
      provider_id: string; tournament_id: string; stage_id: string | null; games: number;
    }>>`
      select fixture.provider_id, fixture.tournament_id, fixture.stage_id,
        count(game.id)::int as games
      from matches fixture
      left join games game on game.match_id = fixture.id
      where fixture.provider = 'cito' and fixture.provider_id in ${tx(matchIds)}
      group by fixture.id
      having fixture.tournament_id <> ${stage.tournament_id}
        or (fixture.stage_id is distinct from ${input.stageId} and count(game.id) > 0)
    `;
    if (incompatible[0]) {
      throw new Error(`Match ${incompatible[0].provider_id} cannot move to this stage because it belongs to another tournament or already has ingested games.`);
    }

    // Competition setup may assign an official multi-day round before fantasy
    // slates are split into daily redrafts. The operator's complete manifest is
    // authoritative, but only unscored matches are safe to move between slates.
    const reassigned = await tx<Array<{ id: string }>>`
      update matches fixture set stage_id = ${input.stageId}
      where fixture.provider = 'cito'
        and fixture.tournament_id = ${stage.tournament_id}
        and fixture.provider_id in ${tx(matchIds)}
        and fixture.stage_id is distinct from ${input.stageId}
        and not exists (select 1 from games game where game.match_id = fixture.id)
      returning fixture.id
    `;

    const rows = await tx<Array<{ id: string; enabled: boolean; next_run_at: string }>>`
      insert into stage_sync_schedules (
        stage_id, enabled, interval_minutes, match_provider_ids, refresh_completed, next_run_at, created_by
      ) values (
        ${input.stageId}, true, ${input.intervalMinutes}, ${matchIds}, ${input.refreshCompleted ?? false},
        clock_timestamp(), ${operatorId}
      )
      on conflict (stage_id) do update set
        enabled = true, interval_minutes = excluded.interval_minutes,
        match_provider_ids = excluded.match_provider_ids,
        refresh_completed = excluded.refresh_completed,
        next_run_at = clock_timestamp()
      returning id, enabled, next_run_at::text
    `;
    return { ...rows[0], reassignedMatches: reassigned.length };
  });
}

export async function setStageSyncScheduleEnabled(sql: Sql, stageId: string, enabled: boolean) {
  const rows = await sql<Array<{ id: string }>>`
    update stage_sync_schedules set enabled = ${enabled},
      next_run_at = case when ${enabled} then clock_timestamp() else next_run_at end
    where stage_id = ${stageId}
    returning id
  `;
  if (!rows[0]) throw new Error("That stage does not have a synchronization schedule.");
}

export async function enqueueDueStageSyncJobs(sql: Sql, limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Schedule batch limit is invalid.");
  return sql.begin(async (tx) => {
    await tx`
      update stage_sync_schedules schedule set enabled = false
      from tournament_stages stage
      where stage.id = schedule.stage_id and stage.status = 'COMPLETE' and schedule.enabled
    `;
    const due = await tx<Array<{
      id: string; stage_id: string; stage_slug: string; stage_name: string; next_run_at: string;
      interval_minutes: number; match_provider_ids: string[]; refresh_completed: boolean; created_by: string;
    }>>`
      select schedule.id, schedule.stage_id, stage.slug as stage_slug, stage.name as stage_name,
        schedule.next_run_at::text, schedule.interval_minutes, schedule.match_provider_ids,
        schedule.refresh_completed, schedule.created_by
      from stage_sync_schedules schedule
      join tournament_stages stage on stage.id = schedule.stage_id
      where schedule.enabled and schedule.next_run_at <= clock_timestamp()
        and stage.status in ('OPEN', 'LOCKED', 'LIVE')
        and not exists (
          select 1 from operator_jobs job
          where job.job_type = 'STAGE_SYNC' and job.status in ('QUEUED', 'RUNNING')
            and job.payload ->> 'scheduleId' = schedule.id::text
        )
      order by
        case stage.status when 'LIVE' then 0 when 'LOCKED' then 1 when 'OPEN' then 2 else 3 end,
        schedule.next_run_at
      for update of schedule skip locked
      limit ${limit}
    `;
    const jobs: Array<{ id: string; scheduleId: string; stageSlug: string }> = [];
    for (const schedule of due) {
      const payload = stageSyncJobPayloadSchema.parse({
        scheduleId: schedule.id,
        stageId: schedule.stage_id,
        stageSlug: schedule.stage_slug,
        stageName: schedule.stage_name,
        matchProviderIds: schedule.match_provider_ids,
        refreshCompleted: schedule.refresh_completed,
      });
      const idempotencyKey = `stage-sync:${schedule.id}:${new Date(schedule.next_run_at).toISOString()}`;
      const rows = await tx<Array<{ id: string }>>`
        insert into operator_jobs (job_type, payload, idempotency_key, requested_by)
        values ('STAGE_SYNC', ${tx.json(payload)}, ${idempotencyKey}, ${schedule.created_by})
        on conflict (idempotency_key) do update set
          status = 'QUEUED', worker_id = null, lease_expires_at = null,
          error_message = null, completed_at = null
        where operator_jobs.status = 'FAILED'
          and operator_jobs.attempts < operator_jobs.max_attempts
        returning id
      `;
      await tx`
        update stage_sync_schedules set last_enqueued_at = clock_timestamp(),
          next_run_at = clock_timestamp() + (${schedule.interval_minutes} * interval '1 minute')
        where id = ${schedule.id}
      `;
      if (rows[0]) jobs.push({ id: rows[0].id, scheduleId: schedule.id, stageSlug: schedule.stage_slug });
    }
    return jobs;
  });
}

export async function finishStageSyncSchedule(sql: Sql, scheduleId: string, stageStatus: string) {
  if (stageStatus !== "COMPLETE") return;
  await sql`update stage_sync_schedules set enabled = false where id = ${scheduleId}`;
}
