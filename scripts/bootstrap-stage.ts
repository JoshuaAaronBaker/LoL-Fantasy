import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { parseFlags } from "../src/lib/cli/arguments";
import { pricePlayers } from "../src/lib/domain/pricing";
import type { PlayerAggregateStats, TeamRoster, TeamRosterPlayer } from "../src/lib/domain/types";
import { CitoApiError, CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { getExistingStage, persistStageCatalog, type CatalogPlayer } from "../src/lib/stages/bootstrap";
import { selectStageTeams } from "../src/lib/stages/team-eligibility";

const args = parseFlags(process.argv.slice(2));
const tournamentId = args.required("tournament");
const slug = args.required("stage");
const name = args.required("name");
const lockAt = new Date(args.required("lock-at"));
const eligibleTeamIds = args.optional("teams")?.split(",");
if (Number.isNaN(lockAt.valueOf()) || lockAt <= new Date()) throw new Error("--lock-at must be a future ISO timestamp.");

const env = getServerEnv();
if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required.");
const sql = createDatabase(env.DATABASE_URL);
const provider = new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY });
const warnings: string[] = [];
let lastRequestAt = 0;

async function paced<T>(label: string, operation: () => Promise<T>) {
  const wait = Math.max(0, 6_100 - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  process.stdout.write(`Fetching ${label}... `);
  const value = await operation();
  lastRequestAt = Date.now();
  console.log("done");
  return value;
}

const emptyStats = (raw: unknown = {}): PlayerAggregateStats => ({
  gamesPlayed: 0, wins: 0, losses: 0, winRate: 0,
  avgKills: 0, avgDeaths: 0, avgAssists: 0, avgCs: 0, raw,
});

try {
  const existing = await getExistingStage(sql, tournamentId, slug);
  if (existing?.status === "OPEN") {
    console.log(JSON.stringify({ stageId: existing.id, status: "OPEN", players: existing.player_count, unchanged: true }, null, 2));
    process.exitCode = 0;
  } else {
    const tournament = await paced("tournament", () => provider.getTournament(tournamentId));
    const discoveredTeams = await paced("tournament matches", () => provider.getTournamentTeams(tournamentId));
    const teams = selectStageTeams(discoveredTeams, eligibleTeamIds);
    const rosters: TeamRoster[] = [];
    const rosterPlayers: Array<{ row: TeamRosterPlayer; rosterIndex: number }> = [];
    for (const source of teams) {
      const roster = await paced(`${source.team.name} roster`, () => provider.getTeamRoster(source.team.providerId));
      const rosterIndex = rosters.push(roster) - 1;
      if (roster.status?.toLowerCase() === "stale") {
        warnings.push(`${source.team.name}: ${roster.statusMessage ?? `roster status is ${roster.status}`}`);
      }
      for (const row of roster.players) {
        if (!row.isActive || !row.isStarter) continue;
        if (!row.role) {
          warnings.push(`${row.player.displayName} was excluded because role ${String(row.player.role)} is unsupported.`);
          continue;
        }
        rosterPlayers.push({ row, rosterIndex });
      }
    }

    const uniquePlayers = new Map<string, { row: TeamRosterPlayer; rosterIndex: number }>();
    for (const item of rosterPlayers) {
      if (uniquePlayers.has(item.row.player.providerId)) {
        warnings.push(`${item.row.player.displayName} appeared on multiple active rosters; the latest team entry won.`);
      }
      uniquePlayers.set(item.row.player.providerId, item);
    }

    const collected: Array<{ item: { row: TeamRosterPlayer; rosterIndex: number }; stats: PlayerAggregateStats }> = [];
    for (const item of uniquePlayers.values()) {
      let stats: PlayerAggregateStats;
      try {
        stats = await paced(`${item.row.player.displayName} stats`, () => provider.getPlayerAggregateStats(item.row.player.providerId));
      } catch (error) {
        if (!(error instanceof CitoApiError)) throw error;
        warnings.push(`${item.row.player.displayName}: aggregate stats unavailable; zero-game projection used.`);
        stats = emptyStats({ unavailable: true });
      }
      collected.push({ item, stats });
    }

    const priced = pricePlayers(collected.map(({ item, stats }) => ({
      playerId: item.row.player.providerId,
      role: item.row.role!,
      avgKills: stats.avgKills,
      avgDeaths: stats.avgDeaths,
      avgAssists: stats.avgAssists,
      avgCs: stats.avgCs,
      winRate: stats.winRate,
    })));
    const priceById = new Map(priced.map((price) => [price.playerId, price]));
    const players: CatalogPlayer[] = collected.map(({ item, stats }) => ({
      ...priceById.get(item.row.player.providerId)!,
      providerId: item.row.player.providerId,
      displayName: item.row.player.displayName,
      imageUrl: item.row.player.imageUrl ?? null,
      teamProviderId: item.row.player.teamProviderId,
      rosterStatus: rosters[item.rosterIndex].status,
      rosterCheckedAt: rosters[item.rosterIndex].checkedAt,
      raw: item.row.raw,
      statsRaw: stats.raw,
    }));
    const result = await persistStageCatalog(sql, {
      tournament, teams, rosters, players, slug, name, lockAt: lockAt.toISOString(), warnings,
    });
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await sql.end();
}
