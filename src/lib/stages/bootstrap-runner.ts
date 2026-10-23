import type { Sql } from "postgres";
import { pricePlayers, projectedFantasyPpg } from "@/lib/domain/pricing";
import {
  PRO_ROLES,
  type PlayerAggregateStats,
  type ProRole,
  type TeamRoster,
  type TeamRosterPlayer,
} from "@/lib/domain/types";
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
  avgVisionScore: null,
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

  for (const source of teams) {
    progress(`Loading ${source.team.name} roster`);
    const roster = await provider.getTeamRoster(source.team.providerId);
    rosters.push(roster);
    if (roster.status?.toLowerCase() === "stale") {
      warnings.push(`${source.team.name}: ${roster.statusMessage ?? `roster status is ${roster.status}`}`);
    }
    for (const row of roster.players) {
      if (row.isActive && row.isStarter && !row.role) {
        warnings.push(`${row.player.displayName} was excluded because its role is unsupported.`);
      }
    }
  }

  type RosterSlot = {
    rosterIndex: number;
    role: ProRole;
    candidates: TeamRosterPlayer[];
    requiresFallback: boolean;
    preferStarter: boolean;
  };
  const slots: RosterSlot[] = [];
  for (const [rosterIndex, roster] of rosters.entries()) {
    const active = roster.players.filter((row) => row.isActive && row.role);
    const startersByRole = new Map(PRO_ROLES.map((role) => [
      role,
      active.filter((row) => row.role === role && row.isStarter),
    ]));
    const hasCompleteStarterFive = PRO_ROLES.every((role) => startersByRole.get(role)!.length === 1);
    for (const role of PRO_ROLES) {
      const candidates = active.filter((row) => row.role === role);
      if (candidates.length === 0) {
        warnings.push(`${roster.team.name}: no active ${role} candidate was returned by the provider.`);
        continue;
      }
      slots.push({
        rosterIndex,
        role,
        candidates,
        requiresFallback: !hasCompleteStarterFive,
        preferStarter: hasCompleteStarterFive,
      });
    }
  }

  const primaryIds = new Map<string, number>();
  for (const slot of slots) {
    const starters = slot.candidates.filter((row) => row.isStarter);
    if (!slot.requiresFallback && starters.length === 1) {
      const id = starters[0].player.providerId;
      primaryIds.set(id, (primaryIds.get(id) ?? 0) + 1);
    }
  }
  for (const slot of slots) {
    const starter = slot.candidates.find((row) => row.isStarter);
    if (starter && (primaryIds.get(starter.player.providerId) ?? 0) > 1) {
      slot.requiresFallback = true;
    }
  }

  const statsTargets = new Map<string, TeamRosterPlayer>();
  for (const slot of slots) {
    const candidates = slot.requiresFallback
      ? slot.candidates
      : slot.candidates.filter((row) => row.isStarter);
    for (const candidate of candidates) statsTargets.set(candidate.player.providerId, candidate);
  }

  const statsById = new Map<string, PlayerAggregateStats>();
  for (const row of statsTargets.values()) {
    let stats: PlayerAggregateStats;
    try {
      progress(`Loading ${row.player.displayName} statistics`);
      stats = await provider.getPlayerAggregateStats(row.player.providerId);
    } catch (error) {
      if (!(error instanceof CitoApiError)) throw error;
      warnings.push(`${row.player.displayName}: aggregate stats unavailable; zero-game projection used.`);
      stats = emptyStats({ unavailable: true });
    }
    statsById.set(row.player.providerId, stats);
    if (row.role === "SUPPORT" && stats.avgVisionScore === null) {
      warnings.push(`${row.player.displayName}: average vision score unavailable; zero-vision projection used.`);
    }
  }

  const usedPlayers = new Set<string>();
  const selected: Array<{ row: TeamRosterPlayer; rosterIndex: number }> = [];
  const orderedSlots = [...slots].sort((left, right) => {
    if (left.requiresFallback !== right.requiresFallback) return left.requiresFallback ? 1 : -1;
    if (left.requiresFallback && left.candidates.length !== right.candidates.length) {
      return left.candidates.length - right.candidates.length;
    }
    const leftChecked = Date.parse(rosters[left.rosterIndex].checkedAt ?? "") || 0;
    const rightChecked = Date.parse(rosters[right.rosterIndex].checkedAt ?? "") || 0;
    return rightChecked - leftChecked
      || rosters[left.rosterIndex].team.name.localeCompare(rosters[right.rosterIndex].team.name)
      || left.role.localeCompare(right.role);
  });
  for (const slot of orderedSlots) {
    const ranked = [...slot.candidates].sort((left, right) => {
      const leftStats = statsById.get(left.player.providerId) ?? emptyStats();
      const rightStats = statsById.get(right.player.providerId) ?? emptyStats();
      const leftProjection = projectedFantasyPpg({
        playerId: left.player.providerId,
        role: slot.role,
        avgKills: leftStats.avgKills,
        avgDeaths: leftStats.avgDeaths,
        avgAssists: leftStats.avgAssists,
        avgCs: leftStats.avgCs,
        avgVisionScore: leftStats.avgVisionScore ?? 0,
        winRate: leftStats.winRate,
      });
      const rightProjection = projectedFantasyPpg({
        playerId: right.player.providerId,
        role: slot.role,
        avgKills: rightStats.avgKills,
        avgDeaths: rightStats.avgDeaths,
        avgAssists: rightStats.avgAssists,
        avgCs: rightStats.avgCs,
        avgVisionScore: rightStats.avgVisionScore ?? 0,
        winRate: rightStats.winRate,
      });
      return (slot.preferStarter ? Number(right.isStarter) - Number(left.isStarter) : 0)
        || rightStats.gamesPlayed - leftStats.gamesPlayed
        || rightProjection - leftProjection
        || left.player.displayName.localeCompare(right.player.displayName);
    });
    const row = ranked.find((candidate) => !usedPlayers.has(candidate.player.providerId));
    if (!row) {
      warnings.push(`${rosters[slot.rosterIndex].team.name}: no unique ${slot.role} player could be selected.`);
      continue;
    }
    usedPlayers.add(row.player.providerId);
    selected.push({ row, rosterIndex: slot.rosterIndex });
    if (slot.requiresFallback) {
      warnings.push(`${rosters[slot.rosterIndex].team.name}: selected ${row.player.displayName} at ${slot.role} using active-roster statistics because starter flags were incomplete or conflicting.`);
    }
  }

  const collected = selected.map((item) => ({
    item,
    stats: statsById.get(item.row.player.providerId) ?? emptyStats(),
  }));

  const priced = pricePlayers(collected.map(({ item, stats }) => ({
    playerId: item.row.player.providerId,
    role: item.row.role!,
    avgKills: stats.avgKills,
    avgDeaths: stats.avgDeaths,
    avgAssists: stats.avgAssists,
    avgCs: stats.avgCs,
    avgVisionScore: stats.avgVisionScore ?? 0,
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
