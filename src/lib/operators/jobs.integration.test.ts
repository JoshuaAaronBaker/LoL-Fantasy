import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import {
  claimOperatorJob,
  completeOperatorJob,
  enqueueStageBootstrapJob,
  failOperatorJob,
} from "./jobs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userId = "96000000-0000-0000-0000-000000000001";
const stageSlug = "worlds-job-integration";

suite("operator job queue", () => {
  beforeAll(async () => {
    await sql!`delete from operator_jobs where requested_by = ${userId}`;
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values (${userId}, 'authenticated', 'authenticated', 'job_test@users.lolfantasy.invalid',
        '{"username":"job_test"}', now(), now())
    `;
    await sql!`insert into fantasy_operators (user_id) values (${userId})`;
  });

  afterAll(async () => {
    await sql!`delete from operator_jobs where requested_by = ${userId}`;
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!.end();
  });

  it("deduplicates, exclusively claims, and ownership-checks completion", async () => {
    const payload = {
      tournamentId: "lol-worlds-test",
      stageSlug,
      stageName: "Worlds Job Integration",
      lockAt: "2099-01-01T00:00:00.000Z",
      teamProviderIds: ["team-a", "team-b"],
    };
    const first = await enqueueStageBootstrapJob(sql!, userId, payload);
    const replay = await enqueueStageBootstrapJob(sql!, userId, payload);
    expect(replay.id).toBe(first.id);

    const claimed = await claimOperatorJob(sql!, "worker-one", 60);
    expect(claimed).toMatchObject({ id: first.id, status: "RUNNING", attempts: 1, workerId: "worker-one" });
    await expect(claimOperatorJob(sql!, "worker-two", 60)).resolves.toBeNull();
    await expect(completeOperatorJob(sql!, first.id, "worker-two", {})).rejects.toThrow(/no longer owns/i);
    await completeOperatorJob(sql!, first.id, "worker-one", { stageId: "stage-one" });
    const rows = await sql!<Array<{ status: string; result: { stageId: string } }>>`
      select status, result from operator_jobs where id = ${first.id}
    `;
    expect(rows).toEqual([{ status: "SUCCEEDED", result: { stageId: "stage-one" } }]);
  });

  it("keeps the queue inaccessible to authenticated browser roles", async () => {
    await expect(sql!.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`set local role authenticated`;
      await tx`select id from operator_jobs`;
    })).rejects.toThrow(/permission denied/i);
  });

  it("allows an operator to explicitly requeue a failed idempotent job", async () => {
    const payload = {
      tournamentId: "lol-worlds-test",
      stageSlug: `${stageSlug}-retry`,
      stageName: "Worlds Job Retry",
      lockAt: "2099-01-01T00:00:00.000Z",
      teamProviderIds: ["team-a"],
    };
    const queued = await enqueueStageBootstrapJob(sql!, userId, payload);
    const claimed = await claimOperatorJob(sql!, "retry-worker", 60);
    expect(claimed?.id).toBe(queued.id);
    await failOperatorJob(sql!, queued.id, "retry-worker", new Error("temporary provider failure"));
    const retried = await enqueueStageBootstrapJob(sql!, userId, payload);
    expect(retried).toMatchObject({ id: queued.id, status: "QUEUED", attempts: 0, workerId: null });
  });
});
