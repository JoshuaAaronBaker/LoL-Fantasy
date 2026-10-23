import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import type { ProRole } from "@/lib/domain/types";
import { getExistingStage, persistStageCatalog, type CatalogPlayer } from "./bootstrap";
import { openNextRoundFromStage } from "./rollover";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const tournamentProviderId = "integration-roster-tournament";

const roles: ProRole[] = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"];
const teams = ["integration-a", "integration-b", "integration-c"].map((providerId) => ({
  team: { provider: "cito" as const, providerId, name: providerId, abbreviation: providerId.at(-1)!, imageUrl: null, raw: {} },
  raw: {},
}));
const players: CatalogPlayer[] = roles.flatMap((role, roleIndex) => teams.map((team, teamIndex) => ({
  playerId: `${role}-${teamIndex}`,
  providerId: `integration-${role}-${teamIndex}`,
  displayName: `${role} ${teamIndex}`,
  imageUrl: null,
  teamProviderId: team.team.providerId,
  role,
  avgKills: 3,
  avgDeaths: 2,
  avgAssists: 5,
  avgCs: 200,
  avgVisionScore: role === "SUPPORT" ? 80 : 30,
  winRate: 0.5,
  projectedPpg: 17.5 + roleIndex,
  rolePercentile: 0.5,
  price: 10_000_000,
  rosterStatus: "fresh",
  rosterCheckedAt: "2026-09-26T00:00:00.000Z",
  raw: {},
  statsRaw: {},
})));

suite("stage catalog repository", () => {
  afterAll(async () => {
    await sql!`
      update tournament_stages set status = 'UPCOMING'
      where tournament_id in (select id from tournaments where provider_id = ${tournamentProviderId})
    `;
    await sql!`delete from tournaments where provider_id = ${tournamentProviderId}`;
    await sql!`delete from pro_players where provider_id like 'integration-%'`;
    await sql!`delete from pro_teams where provider_id like 'integration-%'`;
    await sql!.end();
  });

  it("atomically opens a viable immutable catalog and detects a replay", async () => {
    const result = await persistStageCatalog(sql!, {
      tournament: {
        provider: "cito", providerId: tournamentProviderId, name: "Integration Tournament",
        startTime: null, endTime: null, raw: {},
      },
      teams,
      rosters: [],
      players,
      slug: "integration-stage",
      name: "Integration Stage",
      lockAt: "2099-01-01T00:00:00.000Z",
      warnings: [],
    });
    expect(result).toMatchObject({ status: "OPEN", players: 15 });
    await expect(getExistingStage(sql!, tournamentProviderId, "integration-stage")).resolves.toMatchObject({
      status: "OPEN", player_count: 15,
    });
    await expect(sql!`
      update player_stage_prices set price = price + 1 where stage_id = ${result.stageId}
    `).rejects.toThrow(/immutable/i);
  });

  it("opens a provider-independent redraft round from an immutable catalog", async () => {
    const source = await getExistingStage(sql!, tournamentProviderId, "integration-stage");
    const result = await openNextRoundFromStage(sql!, {
      sourceStageId: source!.id,
      slug: "integration-round-two",
      name: "Integration Round Two",
      lockAt: "2099-01-02T00:00:00.000Z",
      eligibleTeamProviderIds: teams.map(({ team }) => team.providerId),
    });

    expect(result).toMatchObject({ status: "OPEN", players: 15, teams: 3 });
    await expect(sql!`
      select count(*)::int as count
      from player_stage_prices
      where stage_id = ${result.stageId} and pricing_method like '%round-rollover'
    `).resolves.toEqual([{ count: 15 }]);
    await expect(openNextRoundFromStage(sql!, {
      sourceStageId: source!.id,
      slug: "integration-invalid-round",
      name: "Integration Invalid Round",
      lockAt: "2099-01-03T00:00:00.000Z",
      eligibleTeamProviderIds: [teams[0].team.providerId],
    })).rejects.toThrow(/valid five-role roster/i);
    await expect(sql!`
      select count(*)::int as count
      from tournament_stages
      where slug = 'integration-invalid-round'
    `).resolves.toEqual([{ count: 0 }]);
  });
});
