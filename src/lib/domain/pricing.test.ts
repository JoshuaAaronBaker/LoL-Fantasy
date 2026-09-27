import { describe, expect, it } from "vitest";
import { pricePlayers, projectedFantasyPpg, type PlayerPerformance } from "./pricing";

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
});
