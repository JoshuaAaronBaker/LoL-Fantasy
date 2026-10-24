import type { ProRole } from "./types";
import { getWorldsPlayerRanking } from "./worlds-player-rankings";

export const PRICING_METHOD = "role-percentile-8m-12m";
export const PRICING_VERSION = 3;
export const WORLDS_PRICING_METHOD = "worlds-expert-ranking-65-form-35";
export const WORLDS_PRICING_VERSION = 4;

const WORLDS_MIN_PRICE = 6_500_000;
const WORLDS_MAX_PRICE = 15_000_000;
const WORLDS_RANKING_WEIGHT = 0.65;

export interface PlayerPerformance {
  playerId: string;
  role: ProRole;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCs: number;
  avgVisionScore: number;
  winRate: number;
}

export interface PlayerPrice extends PlayerPerformance {
  projectedPpg: number;
  rolePercentile: number;
  price: number;
}

export interface ProjectedPlayer {
  playerId: string;
  role: ProRole;
  projectedPpg: number;
}

export interface WorldsRankedPlayer extends ProjectedPlayer {
  displayName: string;
}

export function projectedFantasyPpg(player: PlayerPerformance) {
  if (player.role === "SUPPORT") {
    return (
      3 * player.avgKills -
      0.75 * player.avgDeaths +
      1.75 * player.avgAssists +
      0.01 * player.avgCs +
      0.025 * player.avgVisionScore
    );
  }

  return (
    3 * player.avgKills -
    player.avgDeaths +
    1.5 * player.avgAssists +
    0.01 * player.avgCs
  );
}

function roundToHalfMillion(value: number) {
  return Math.round(value / 500_000) * 500_000;
}

export function priceProjectedPlayers<T extends ProjectedPlayer>(projected: T[]) {
  return projected.map((player) => {
    const rolePlayers = projected
      .filter((candidate) => candidate.role === player.role)
      .sort((a, b) => b.projectedPpg - a.projectedPpg || a.playerId.localeCompare(b.playerId));
    if (rolePlayers.length === 1) return { ...player, rolePercentile: 0.5, price: 10_000_000 };

    const tiedIndexes = rolePlayers
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => Math.abs(candidate.projectedPpg - player.projectedPpg) < 0.000001)
      .map(({ index }) => index);
    const averageRank = tiedIndexes.reduce((total, rank) => total + rank, 0) / tiedIndexes.length;
    const rolePercentile = 1 - averageRank / (rolePlayers.length - 1);
    return {
      ...player,
      rolePercentile,
      price: roundToHalfMillion(8_000_000 + rolePercentile * 4_000_000),
    };
  });
}

export function priceWorldsRankedPlayers<T extends WorldsRankedPlayer>(projected: T[]) {
  const formPrices = priceProjectedPlayers(projected);
  return formPrices.map((player) => {
    const ranking = getWorldsPlayerRanking(player.role, player.displayName);
    if (!ranking) {
      throw new Error(`Missing Worlds ${player.role} ranking for ${player.displayName}.`);
    }
    const blendedPercentile =
      WORLDS_RANKING_WEIGHT * ranking.percentile +
      (1 - WORLDS_RANKING_WEIGHT) * player.rolePercentile;
    return {
      ...player,
      rolePercentile: blendedPercentile,
      price: roundToHalfMillion(
        WORLDS_MIN_PRICE + blendedPercentile * (WORLDS_MAX_PRICE - WORLDS_MIN_PRICE),
      ),
      expertRank: ranking.rank,
      expertFieldSize: ranking.fieldSize,
      expertPercentile: ranking.percentile,
      formPercentile: player.rolePercentile,
    };
  });
}

export function pricePlayers(players: PlayerPerformance[]): PlayerPrice[] {
  return priceProjectedPlayers(players.map((player) => ({
    ...player,
    projectedPpg: projectedFantasyPpg(player),
  })));
}
