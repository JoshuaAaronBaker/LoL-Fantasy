import { describe, expect, it } from "vitest";
import { applyCaptainMultiplier, calculateFantasyScore, type ScoringRule } from "./scoring";

const rules: ScoringRule[] = [
  { metric: "kills", pointsPerUnit: 3, role: null },
  { metric: "assists", pointsPerUnit: 1.5, role: null },
  { metric: "deaths", pointsPerUnit: -1, role: null },
  { metric: "cs", pointsPerUnit: 0.01, role: null },
  { metric: "win", pointsPerUnit: 2, role: null },
];

describe("fantasy scoring", () => {
  it("scores the product example deterministically", () => {
    const result = calculateFantasyScore(
      { kills: 8, deaths: 2, assists: 11, cs: 287, won: true, role: "MID" },
      rules,
    );

    expect(result).toEqual({
      total: "43.37",
      breakdown: { kills: "24.00", deaths: "-2.00", assists: "16.50", cs: "2.87", win: "2.00" },
    });
    expect(applyCaptainMultiplier(result.total, 1.5)).toBe("65.06");
  });

  it("prefers a matching role rule over the global rule", () => {
    const result = calculateFantasyScore(
      { kills: 0, deaths: 0, assists: 10, cs: 0, won: false, role: "SUPPORT" },
      [...rules, { metric: "assists", pointsPerUnit: 2, role: "SUPPORT" }],
    );
    expect(result.total).toBe("20.00");
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
