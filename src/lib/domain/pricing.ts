import type { ProRole } from "./types";

export const PRICING_METHOD = "role-percentile-8m-12m";
export const PRICING_VERSION = 3;

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

export function pricePlayers(players: PlayerPerformance[]): PlayerPrice[] {
  const projected = players.map((player) => ({ ...player, projectedPpg: projectedFantasyPpg(player) }));
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
