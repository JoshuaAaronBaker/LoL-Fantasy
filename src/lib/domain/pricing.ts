import type { ProRole } from "./types";
import { getWorldsPlayerRanking } from "./worlds-player-rankings";

export const PRICING_METHOD = "role-percentile-8m-12m";
export const PRICING_VERSION = 3;
export const WORLDS_PRICING_METHOD = "worlds-expert-ranking-100-5m-15m";
export const WORLDS_PRICING_VERSION = 6;
export const WORLDS_DAILY_PRICING_METHOD = "worlds-expert-ranking-daily-balanced-7m-13m";
export const WORLDS_DAILY_PRICING_VERSION = 7;

const WORLDS_MIN_PRICE = 5_000_000;
const WORLDS_MAX_PRICE = 15_000_000;
const WORLDS_DAILY_MIN_PRICE = 7_000_000;
const WORLDS_DAILY_MAX_PRICE = 13_000_000;

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
    return {
      ...player,
      rolePercentile: ranking.percentile,
      price: roundToHalfMillion(
        WORLDS_MIN_PRICE + ranking.percentile * (WORLDS_MAX_PRICE - WORLDS_MIN_PRICE),
      ),
      expertRank: ranking.rank,
      expertFieldSize: ranking.fieldSize,
      expertPercentile: ranking.percentile,
      formPercentile: player.rolePercentile,
    };
  });
}

export function priceWorldsDailyRankedPlayers<T extends WorldsRankedPlayer>(projected: T[]) {
  const globallyRanked = priceWorldsRankedPlayers(projected);
  const slateRankByPlayerId = new Map<string, {
    rank: number;
    fieldSize: number;
    percentile: number;
  }>();

  for (const role of ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"] as const) {
    const rolePlayers = globallyRanked
      .filter((player) => player.role === role)
      .sort((a, b) => a.expertRank - b.expertRank || a.playerId.localeCompare(b.playerId));

    rolePlayers.forEach((player, index) => {
      slateRankByPlayerId.set(player.playerId, {
        rank: index + 1,
        fieldSize: rolePlayers.length,
        percentile: rolePlayers.length === 1 ? 0.5 : 1 - index / (rolePlayers.length - 1),
      });
    });
  }

  return globallyRanked.map((player) => {
    const slateRanking = slateRankByPlayerId.get(player.playerId);
    if (!slateRanking) throw new Error(`Missing Worlds slate ranking for ${player.displayName}.`);

    return {
      ...player,
      rolePercentile: slateRanking.percentile,
      price: roundToHalfMillion(
        WORLDS_DAILY_MIN_PRICE
          + slateRanking.percentile * (WORLDS_DAILY_MAX_PRICE - WORLDS_DAILY_MIN_PRICE),
      ),
      slateRank: slateRanking.rank,
      slateFieldSize: slateRanking.fieldSize,
      slatePercentile: slateRanking.percentile,
    };
  });
}

export function pricePlayers(players: PlayerPerformance[]): PlayerPrice[] {
  return priceProjectedPlayers(players.map((player) => ({
    ...player,
    projectedPpg: projectedFantasyPpg(player),
  })));
}
