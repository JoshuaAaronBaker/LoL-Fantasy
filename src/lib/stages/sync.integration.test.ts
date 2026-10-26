import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import type { NormalizedGame } from "@/lib/domain/types";
import type { EsportsDataProvider } from "@/lib/providers/esports-data-provider";
import { synchronizeStage } from "./sync";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const tournamentProviderId = "stage-sync-integration-tournament";
const matchProviderId = "stage-sync-integration-match";
const gameProviderId = "stage-sync-integration-game";
const stageSlug = "stage-sync-integration";

const game: NormalizedGame = {
  provider: "cito",
  providerId: gameProviderId,
  matchProviderId,
  gameNumber: 1,
  status: "COMPLETED",
  winnerTeamProviderId: null,
  startedAt: "2026-09-26T10:00:00.000Z",
  endedAt: "2026-09-26T10:30:00.000Z",
  raw: {},
};

function testProvider() {
  const getTournament = vi.fn(async () => ({
    provider: "cito" as const, providerId: tournamentProviderId, name: "Stage Sync Integration",
    startTime: null, endTime: null, raw: {},
  }));
  const getGame = vi.fn(async () => game);
  const getGamePlayerStats = vi.fn(async () => ({ stats: [], raw: {} }));
  const provider: EsportsDataProvider = {
    name: "cito",
    getTournaments: async () => [],
    getTournament,
    getTournamentTeams: async () => [],
    getTeamRoster: async () => { throw new Error("not used"); },
    getPlayerAggregateStats: async () => { throw new Error("not used"); },
    getMatch: async () => ({
      provider: "cito", providerId: matchProviderId, tournamentProviderId,
      stageLabel: "Integration", startTime: game.startedAt, status: "COMPLETED", teams: [], raw: {},
    }),
    getMatchGames: async () => [game],
    getGame,
    getGamePlayerStats,
  };
  return { provider, getTournament, getGame, getGamePlayerStats };
}

suite("stage synchronization", () => {
  beforeAll(async () => {
    await sql!`delete from ingestion_runs where resource_id = ${matchProviderId}`;
    await sql!`delete from tournaments where provider = 'cito' and provider_id = ${tournamentProviderId}`;
    const tournaments = await sql!<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name)
      values ('cito', ${tournamentProviderId}, 'Stage Sync Integration') returning id
    `;
    await sql!`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, ${stageSlug}, 'Stage Sync Integration', 1, '2020-01-01', 'OPEN')
    `;
  });

  afterAll(async () => {
    await sql!`delete from ingestion_runs where resource_id = ${matchProviderId}`;
    await sql!`delete from tournaments where provider = 'cito' and provider_id = ${tournamentProviderId}`;
    await sql!.end();
  });

  it("assigns, ingests, scores, completes, and then converges on replay", async () => {
    const { provider, getTournament, getGame, getGamePlayerStats } = testProvider();
    await sql!`
      insert into matches (provider, provider_id, tournament_id, stage_id, status)
      select 'cito', ${`${matchProviderId}-outside-manifest`}, tournament_id, id, 'UNSTARTED'
      from tournament_stages where slug = ${stageSlug}
    `;
    const first = await synchronizeStage(sql!, provider, {
      stageSlug,
      matchIds: [matchProviderId],
    });
    expect(first).toMatchObject({
      status: "SUCCEEDED",
      previousStageStatus: "OPEN",
      stageStatus: "COMPLETE",
      matchesProcessed: 1,
      matchesAssigned: 1,
      gamesIngested: 1,
    });

    await sql!`delete from matches where provider_id = ${`${matchProviderId}-outside-manifest`}`;

    const second = await synchronizeStage(sql!, provider, { stageSlug });
    expect(second).toMatchObject({
      status: "UNCHANGED",
      previousStageStatus: "COMPLETE",
      stageStatus: "COMPLETE",
      matchesProcessed: 0,
      matchesSkipped: 1,
      matchesAssigned: 0,
      gamesIngested: 0,
    });
    expect(getGame).toHaveBeenCalledTimes(1);
    expect(getGamePlayerStats).toHaveBeenCalledTimes(1);
    expect(getTournament).not.toHaveBeenCalled();

    const rows = await sql!<Array<{ stage_status: string; games: number; succeeded: number; unchanged: number }>>`
      select s.status as stage_status,
        (select count(*)::int from games g join matches m on m.id = g.match_id where m.stage_id = s.id) as games,
        (select count(*)::int from stage_sync_runs r where r.stage_id = s.id and r.status = 'SUCCEEDED') as succeeded,
        (select count(*)::int from stage_sync_runs r where r.stage_id = s.id and r.status = 'UNCHANGED') as unchanged
      from tournament_stages s where s.slug = ${stageSlug}
    `;
    expect(rows[0]).toEqual({ stage_status: "COMPLETE", games: 1, succeeded: 1, unchanged: 1 });
  });

  it("records a failed operator run without changing stage data", async () => {
    const { provider } = testProvider();
    provider.getMatch = async () => { throw new Error("provider unavailable"); };
    await expect(synchronizeStage(sql!, provider, {
      stageSlug,
      refreshCompleted: true,
    })).rejects.toThrow("provider unavailable");
    const rows = await sql!<Array<{ status: string; error_message: string }>>`
      select status, error_message from stage_sync_runs
      where stage_id = (select id from tournament_stages where slug = ${stageSlug})
      order by started_at desc limit 1
    `;
    expect(rows[0]).toMatchObject({ status: "FAILED" });
    expect(rows[0].error_message).toContain("provider unavailable");
  });
});
