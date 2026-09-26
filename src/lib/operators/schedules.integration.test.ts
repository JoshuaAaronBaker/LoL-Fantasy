import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { enqueueDueStageSyncJobs, upsertStageSyncSchedule } from "./schedules";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userId = "97000000-0000-0000-0000-000000000001";
const tournamentProviderId = "schedule-integration-tournament";
const stageSlug = "schedule-integration-stage";

suite("stage synchronization schedules", () => {
  let stageId: string;

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
    const stages = await sql!<Array<{ id: string }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, ${stageSlug}, 'Schedule Integration', 1, '2099-01-01', 'OPEN')
      returning id
    `;
    stageId = stages[0].id;
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
    expect(first).toEqual([expect.objectContaining({ scheduleId: schedule.id, stageSlug })]);
    expect(overlapping).toEqual([]);
    const jobs = await sql!<Array<{ job_type: string; status: string; stage_slug: string; matches: string[] }>>`
      select job_type, status, payload ->> 'stageSlug' as stage_slug,
        array(select jsonb_array_elements_text(payload -> 'matchProviderIds')) as matches
      from operator_jobs where id = ${first[0].id}
    `;
    expect(jobs).toEqual([{
      job_type: "STAGE_SYNC",
      status: "QUEUED",
      stage_slug: stageSlug,
      matches: ["match-one", "match-two"],
    }]);
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
