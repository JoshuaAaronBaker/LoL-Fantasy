import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { enqueueDueStageSyncJobs, upsertStageSyncSchedule } from "./schedules";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userId = "97000000-0000-0000-0000-000000000001";
const tournamentProviderId = "schedule-integration-tournament";
const stageSlug = "schedule-integration-stage";
const sourceStageSlug = "schedule-integration-source";

suite("stage synchronization schedules", () => {
  let stageId: string;
  let sourceStageId: string;
  let tournamentId: string;

  beforeAll(async () => {
    await sql!`delete from operator_jobs where requested_by = ${userId}`;
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!`delete from tournaments where provider_id = ${tournamentProviderId}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values (${userId}, 'authenticated', 'authenticated', 'schedule_test@users.lolfantasy.invalid',
        '{"username":"schedule_test"}', now(), now())
    `;
    await sql!`insert into fantasy_operators (user_id) values (${userId})`;
    const tournaments = await sql!<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name)
      values ('cito', ${tournamentProviderId}, 'Schedule Integration') returning id
    `;
    tournamentId = tournaments[0].id;
    const stages = await sql!<Array<{ id: string }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, ${stageSlug}, 'Schedule Integration', 1, '2099-01-01', 'OPEN')
      returning id
    `;
    stageId = stages[0].id;
    const sourceStages = await sql!<Array<{ id: string }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, ${sourceStageSlug}, 'Schedule Source', 2, '2099-01-01', 'OPEN')
      returning id
    `;
    sourceStageId = sourceStages[0].id;
  });

  afterAll(async () => {
    await sql!`delete from operator_jobs where requested_by = ${userId}`;
    await sql!`delete from tournaments where provider_id = ${tournamentProviderId}`;
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!.end();
  });

  it("converts one due manifest into one durable sync job", async () => {
    const schedule = await upsertStageSyncSchedule(sql!, userId, {
      stageId,
      intervalMinutes: 15,
      matchProviderIds: ["match-one", "match-two"],
    });
    expect(schedule.enabled).toBe(true);

    const first = await enqueueDueStageSyncJobs(sql!);
    const overlapping = await enqueueDueStageSyncJobs(sql!);
    const scheduledJob = first.find((job) => job.scheduleId === schedule.id);
    expect(scheduledJob).toEqual(expect.objectContaining({ scheduleId: schedule.id, stageSlug }));
    expect(overlapping.filter((job) => job.scheduleId === schedule.id)).toEqual([]);
    const jobs = await sql!<Array<{ job_type: string; status: string; stage_slug: string; matches: string[] }>>`
      select job_type, status, payload ->> 'stageSlug' as stage_slug,
        array(select jsonb_array_elements_text(payload -> 'matchProviderIds')) as matches
      from operator_jobs where id = ${scheduledJob!.id}
    `;
    expect(jobs).toEqual([{
      job_type: "STAGE_SYNC",
      status: "QUEUED",
      stage_slug: stageSlug,
      matches: ["match-one", "match-two"],
    }]);
    await sql!`delete from operator_jobs where id = ${scheduledJob!.id}`;
  });

  it("moves only unscored same-tournament matches into the scheduled slate", async () => {
    await sql!`
      insert into matches (provider, provider_id, tournament_id, stage_id, status)
      values ('cito', 'schedule-movable-match', ${tournamentId}, ${sourceStageId}, 'UNSTARTED')
    `;
    const schedule = await upsertStageSyncSchedule(sql!, userId, {
      stageId,
      intervalMinutes: 5,
      matchProviderIds: ["schedule-movable-match"],
    });
    expect(schedule.reassignedMatches).toBe(1);
    const rows = await sql!<Array<{ stage_id: string }>>`
      select stage_id from matches where provider_id = 'schedule-movable-match'
    `;
    expect(rows).toEqual([{ stage_id: stageId }]);
  });

  it("refuses to move a match after game ingestion", async () => {
    const matches = await sql!<Array<{ id: string }>>`
      insert into matches (provider, provider_id, tournament_id, stage_id, status)
      values ('cito', 'schedule-scored-match', ${tournamentId}, ${sourceStageId}, 'COMPLETED')
      returning id
    `;
    await sql!`
      insert into games (provider, provider_id, match_id, game_number, status, source_kind)
      values ('cito', 'schedule-scored-game', ${matches[0].id}, 1, 'COMPLETED', 'live')
    `;
    await expect(upsertStageSyncSchedule(sql!, userId, {
      stageId,
      intervalMinutes: 5,
      matchProviderIds: ["schedule-scored-match"],
    })).rejects.toThrow(/already has ingested games/i);
  });

  it("requeues a failed due synchronization until its attempt limit", async () => {
    const schedule = await upsertStageSyncSchedule(sql!, userId, {
      stageId,
      intervalMinutes: 5,
      matchProviderIds: ["schedule-retry-match"],
    });
    const first = await enqueueDueStageSyncJobs(sql!);
    const job = first.find((entry) => entry.scheduleId === schedule.id)!;
    await sql!`update operator_jobs set status = 'FAILED', attempts = 1 where id = ${job.id}`;
    await sql!`
      update stage_sync_schedules set next_run_at = ${schedule.next_run_at}
      where id = ${schedule.id}
    `;
    const retried = await enqueueDueStageSyncJobs(sql!);
    expect(retried).toContainEqual(expect.objectContaining({ id: job.id, scheduleId: schedule.id }));
    const rows = await sql!<Array<{ status: string; attempts: number }>>`
      select status, attempts from operator_jobs where id = ${job.id}
    `;
    expect(rows).toEqual([{ status: "QUEUED", attempts: 1 }]);
  });

  it("automatically disables schedules for completed stages", async () => {
    await sql!`update tournament_stages set status = 'COMPLETE' where id = ${stageId}`;
    await enqueueDueStageSyncJobs(sql!);
    const rows = await sql!<Array<{ enabled: boolean }>>`
      select enabled from stage_sync_schedules where stage_id = ${stageId}
    `;
    expect(rows).toEqual([{ enabled: false }]);
  });
});
