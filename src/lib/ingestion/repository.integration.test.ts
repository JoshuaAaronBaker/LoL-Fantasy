import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { FixtureEsportsDataProvider } from "@/lib/providers/fixture";
import { loadCompletedMatch } from "./load-match";
import { persistIngestionBundle, recalculateScores } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;

suite("ingestion repository", () => {
  beforeAll(async () => {
    await sql!`delete from ingestion_runs where resource_id = 'sample-match-1'`;
    await sql!`delete from tournaments where provider = 'cito' and provider_id = 'sample-worlds-2026'`;
  });

  afterAll(async () => {
    await sql!`delete from ingestion_runs where resource_id = 'sample-match-1'`;
    await sql!`delete from tournaments where provider = 'cito' and provider_id = 'sample-worlds-2026'`;
    await sql!.end();
  });

  it("converges when the same completed game is imported twice", async () => {
    const provider = await FixtureEsportsDataProvider.fromFile(
      resolve(process.cwd(), "fixtures/cito/completed-match.json"),
    );
    const bundle = await loadCompletedMatch(provider, {
      tournamentId: "sample-worlds-2026",
      matchId: "sample-match-1",
    });

    const first = await persistIngestionBundle(sql!, bundle, "fixture");
    const second = await persistIngestionBundle(sql!, bundle, "fixture");
    expect(first.status).toBe("SUCCEEDED");
    expect(second.status).toBe("UNCHANGED");

    const counts = await sql!<Array<{ games: number; stats: number; scores: number }>>`
      select count(distinct g.id)::int as games, count(distinct s.id)::int as stats,
             count(distinct score.id)::int as scores
      from games g
      join player_game_stats s on s.game_id = g.id
      join player_game_scores score on score.player_game_stat_id = s.id
      where g.provider_id = 'sample-game-1'
    `;
    expect(counts[0]).toEqual({ games: 1, stats: 10, scores: 10 });

    const score = await sql!<Array<{ base_score: string }>>`
      select score.base_score::text
      from player_game_scores score
      join player_game_stats stat on stat.id = score.player_game_stat_id
      join pro_players player on player.id = stat.player_id
      where player.provider_id = 'sample-blue-mid'
    `;
    expect(score[0].base_score).toBe("41.37");

    await expect(recalculateScores(sql!, "default-v2", "sample-game-1")).resolves.toMatchObject({ count: 10 });
  });

  it("rolls back domain rows and records a failed run", async () => {
    const provider = await FixtureEsportsDataProvider.fromFile(
      resolve(process.cwd(), "fixtures/cito/completed-match.json"),
    );
    const bundle = await loadCompletedMatch(provider, {
      tournamentId: "sample-worlds-2026",
      matchId: "sample-match-1",
    });
    bundle.tournament.providerId = "invalid-tournament";
    bundle.match.providerId = "invalid-match";
    bundle.match.tournamentProviderId = "invalid-tournament";
    bundle.games[0].game.providerId = "invalid-game";
    bundle.games[0].game.matchProviderId = "invalid-match";
    bundle.games[0].stats[0].kills = -1;

    await expect(persistIngestionBundle(sql!, bundle, "fixture")).rejects.toThrow();

    const domainRows = await sql!<Array<{ count: number }>>`
      select count(*)::int as count from tournaments where provider_id = 'invalid-tournament'
    `;
    const failedRuns = await sql!<Array<{ count: number }>>`
      select count(*)::int as count from ingestion_runs
      where resource_id = 'invalid-match' and status = 'FAILED'
    `;
    expect(domainRows[0].count).toBe(0);
    expect(failedRuns[0].count).toBe(1);
    await sql!`delete from ingestion_runs where resource_id = 'invalid-match'`;
  });
});
