import { describe, expect, it } from "vitest";
import { applyCaptainMultiplier, calculateFantasyScore, type ScoringRule } from "./scoring";

const rules: ScoringRule[] = [
  { metric: "kills", pointsPerUnit: 3, role: null },
  { metric: "assists", pointsPerUnit: 1.5, role: null },
  { metric: "deaths", pointsPerUnit: -1, role: null },
  { metric: "cs", pointsPerUnit: 0.01, role: null },
];

describe("fantasy scoring", () => {
  it("scores the product example deterministically", () => {
    const result = calculateFantasyScore(
      { kills: 8, deaths: 2, assists: 11, cs: 287, won: true, role: "MID" },
      rules,
    );

    expect(result).toEqual({
      total: "41.37",
      breakdown: {
        kills: "24.00",
        deaths: "-2.00",
        assists: "16.50",
        cs: "2.87",
        vision: "0.00",
        win: "0.00",
      },
    });
    expect(applyCaptainMultiplier(result.total, 1.5)).toBe("62.06");
  });

  it("does not award points for a win", () => {
    const commonStats = { kills: 3, deaths: 1, assists: 4, cs: 200, role: "MID" as const };

    const win = calculateFantasyScore({ ...commonStats, won: true }, rules);
    const loss = calculateFantasyScore({ ...commonStats, won: false }, rules);

    expect(win).toEqual(loss);
    expect(win.breakdown.win).toBe("0.00");
  });

  it("prefers a matching role rule over the global rule", () => {
    const result = calculateFantasyScore(
      {
        kills: 1,
        deaths: 2,
        assists: 10,
        cs: 35,
        visionScore: 100,
        won: false,
        role: "SUPPORT",
      },
      [
        ...rules,
        { metric: "deaths", pointsPerUnit: -0.75, role: "SUPPORT" },
        { metric: "assists", pointsPerUnit: 1.75, role: "SUPPORT" },
        { metric: "vision", pointsPerUnit: 0.025, role: "SUPPORT" },
      ],
    );
    expect(result.total).toBe("21.85");
    expect(result.breakdown.vision).toBe("2.50");
  });

  it("handles a zero-stat loss", () => {
    expect(
      calculateFantasyScore(
        { kills: 0, deaths: 0, assists: 0, cs: 0, won: false, role: null },
        rules,
      ).total,
    ).toBe("0.00");
  });
});
