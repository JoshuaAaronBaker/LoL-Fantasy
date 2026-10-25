import { describe, expect, it } from "vitest";
import {
  pricePlayers,
  priceProjectedPlayers,
  priceWorldsDailyRankedPlayers,
  priceWorldsRankedPlayers,
  projectedFantasyPpg,
  type PlayerPerformance,
} from "./pricing";
import { WORLDS_PLAYER_RANKINGS } from "./worlds-player-rankings";

const performance = (playerId: string, avgKills: number): PlayerPerformance => ({
  playerId,
  role: "MID",
  avgKills,
  avgDeaths: 2,
  avgAssists: 5,
  avgCs: 250,
  avgVisionScore: 50,
  winRate: 0.5,
});

describe("stage pricing", () => {
  it("projects points using the active fantasy weights", () => {
    expect(projectedFantasyPpg(performance("a", 4))).toBe(20);
  });

  it("does not use win rate in projected points", () => {
    const lowWinRate = { ...performance("low", 4), winRate: 0.2 };
    const highWinRate = { ...performance("high", 4), winRate: 0.8 };

    expect(projectedFantasyPpg(lowWinRate)).toBe(projectedFantasyPpg(highWinRate));
  });

  it("uses support-specific assists, deaths, and vision weights", () => {
    expect(projectedFantasyPpg({
      ...performance("support", 1),
      role: "SUPPORT",
      avgDeaths: 2,
      avgAssists: 10,
      avgCs: 35,
      avgVisionScore: 100,
    })).toBe(21.85);
  });

  it("maps role rank to rounded prices", () => {
    const result = pricePlayers([performance("best", 5), performance("mid", 4), performance("last", 3)]);
    expect(result.map(({ playerId, price }) => [playerId, price])).toEqual([
      ["best", 12_000_000],
      ["mid", 10_000_000],
      ["last", 8_000_000],
    ]);
  });

  it("uses average ranks for ties and the midpoint for one-player roles", () => {
    const tied = pricePlayers([performance("a", 4), performance("b", 4), performance("c", 2)]);
    expect(tied[0].price).toBe(11_000_000);
    expect(tied[1].price).toBe(11_000_000);
    expect(pricePlayers([performance("solo", 4)])[0].price).toBe(10_000_000);
  });

  it("re-ranks stored projections for a reduced round field", () => {
    const result = priceProjectedPlayers([
      { playerId: "first", role: "TOP", projectedPpg: 20 },
      { playerId: "second", role: "TOP", projectedPpg: 15 },
    ]);

    expect(result.map(({ playerId, price }) => [playerId, price])).toEqual([
      ["first", 12_000_000],
      ["second", 8_000_000],
    ]);
  });

  it("anchors Worlds prices to the master ranking without re-normalizing eligible players", () => {
    const result = priceWorldsRankedPlayers([
      { playerId: "zeus", displayName: "Zeus", role: "TOP", projectedPpg: 10 },
      { playerId: "zest", displayName: "Zest", role: "TOP", projectedPpg: 20 },
    ]);

    expect(result.map(({ playerId, expertRank, price }) => [playerId, expertRank, price])).toEqual([
      ["zeus", 1, 15_000_000],
      ["zest", 19, 6_000_000],
    ]);
  });

  it("uses only expert ranking order for Worlds prices", () => {
    const result = priceWorldsRankedPlayers([
      { playerId: "zeus", displayName: "Zeus", role: "TOP", projectedPpg: 0 },
      { playerId: "kiin", displayName: "Kiin", role: "TOP", projectedPpg: 100 },
    ]);

    expect(result.map(({ playerId, expertRank, price }) => [playerId, expertRank, price])).toEqual([
      ["zeus", 1, 15_000_000],
      ["kiin", 2, 14_500_000],
    ]);
  });

  it("rebalances a Worlds daily slate around the salary cap without changing expert order", () => {
    const names = ["Zeus", "Kiin", "Siwoo", "TheShy", "BrokenBlade", "Dhokla", "369", "Myrwn"];
    const result = priceWorldsDailyRankedPlayers(names.map((displayName, index) => ({
      playerId: displayName.toLowerCase(),
      displayName,
      role: "TOP" as const,
      projectedPpg: index,
    }))).sort((a, b) => a.slateRank - b.slateRank);

    expect(result.map(({ displayName, price }) => [displayName, price])).toEqual([
      ["Zeus", 13_000_000],
      ["Kiin", 12_000_000],
      ["Siwoo", 11_500_000],
      ["TheShy", 10_500_000],
      ["BrokenBlade", 9_500_000],
      ["Dhokla", 8_500_000],
      ["369", 8_000_000],
      ["Myrwn", 7_000_000],
    ]);
    expect(result.reduce((total, player) => total + player.price, 0) / result.length)
      .toBe(10_000_000);
    expect(result.every((player, index) => index === 0 || result[index - 1].price > player.price))
      .toBe(true);
  });

  it("keeps every Worlds role in ranking order regardless of projected form", () => {
    for (const role of ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"] as const) {
      const result = priceWorldsRankedPlayers(
        WORLDS_PLAYER_RANKINGS[role].map((displayName, index, rankings) => ({
          playerId: `${role}-${index}`,
          displayName,
          role,
          projectedPpg: rankings.length - index,
        })).reverse(),
      ).sort((a, b) => a.expertRank - b.expertRank);

      expect(result[0].price).toBe(15_000_000);
      expect(result.at(-1)?.price).toBe(5_000_000);
      expect(result.every((player, index) => index === 0 || result[index - 1].price >= player.price)).toBe(true);
    }
  });

  it("requires every Worlds player to have a role-specific ranking", () => {
    expect(() => priceWorldsRankedPlayers([
      { playerId: "unknown", displayName: "Unknown", role: "MID", projectedPpg: 20 },
    ])).toThrow(/missing worlds mid ranking/i);
  });
});
