import type { Sql } from "postgres";
import { pricePlayers } from "@/lib/domain/pricing";
import type { PlayerAggregateStats, TeamRoster, TeamRosterPlayer } from "@/lib/domain/types";
import type { EsportsDataProvider } from "@/lib/providers/esports-data-provider";
import { CitoApiError } from "@/lib/providers/cito/client";
import { getExistingStage, persistStageCatalog, type CatalogPlayer } from "@/lib/stages/bootstrap";
import { selectStageTeams } from "@/lib/stages/team-eligibility";

export interface StageBootstrapRunInput {
  tournamentId: string;
  slug: string;
  name: string;
  lockAt: string;
  eligibleTeamIds?: string[];
}

export type StageBootstrapProgress = (message: string) => void;

const emptyStats = (raw: unknown = {}): PlayerAggregateStats => ({
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  avgKills: 0,
  avgDeaths: 0,
  avgAssists: 0,
  avgCs: 0,
  raw,
});

export async function runStageBootstrap(
  sql: Sql,
  provider: EsportsDataProvider,
  input: StageBootstrapRunInput,
  progress: StageBootstrapProgress = () => undefined,
) {
  const lockAt = new Date(input.lockAt);
  if (Number.isNaN(lockAt.valueOf()) || lockAt <= new Date()) {
    throw new Error("The stage lock must be a future ISO timestamp.");
  }
  const existing = await getExistingStage(sql, input.tournamentId, input.slug);
  if (existing?.status === "OPEN") {
    return { stageId: existing.id, status: "OPEN" as const, players: existing.player_count, unchanged: true };
  }

  const warnings: string[] = [];
  progress("Fetching tournament metadata");
  const tournament = await provider.getTournament(input.tournamentId);
  progress("Discovering tournament teams");
  const discoveredTeams = await provider.getTournamentTeams(input.tournamentId);
  const teams = selectStageTeams(discoveredTeams, input.eligibleTeamIds);
  const rosters: TeamRoster[] = [];
  const rosterPlayers: Array<{ row: TeamRosterPlayer; rosterIndex: number }> = [];

  for (const source of teams) {
    progress(`Loading ${source.team.name} roster`);
    const roster = await provider.getTeamRoster(source.team.providerId);
    const rosterIndex = rosters.push(roster) - 1;
    if (roster.status?.toLowerCase() === "stale") {
      warnings.push(`${source.team.name}: ${roster.statusMessage ?? `roster status is ${roster.status}`}`);
    }
    for (const row of roster.players) {
      if (!row.isActive || !row.isStarter) continue;
      if (!row.role) {
        warnings.push(`${row.player.displayName} was excluded because its role is unsupported.`);
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

  const collected: Array<{
    item: { row: TeamRosterPlayer; rosterIndex: number };
    stats: PlayerAggregateStats;
  }> = [];
  for (const item of uniquePlayers.values()) {
    let stats: PlayerAggregateStats;
    try {
      progress(`Loading ${item.row.player.displayName} statistics`);
      stats = await provider.getPlayerAggregateStats(item.row.player.providerId);
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
  progress("Persisting and opening immutable stage catalog");
  return persistStageCatalog(sql, {
    tournament,
    teams,
    rosters,
    players,
    slug: input.slug,
    name: input.name,
    lockAt: lockAt.toISOString(),
    warnings,
  });
}
