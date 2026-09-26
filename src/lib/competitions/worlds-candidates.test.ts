import { describe, expect, it } from "vitest";
import type { TournamentCatalogEntry } from "@/lib/domain/types";
import { isWorldChampionshipCandidate, selectWorldChampionshipCandidates } from "./worlds-candidates";

function tournament(overrides: Partial<TournamentCatalogEntry>): TournamentCatalogEntry {
  return {
    provider: "cito",
    providerId: "tournament",
    name: "Tournament",
    startTime: null,
    endTime: null,
    leagueName: null,
    leagueSlug: null,
    isInternational: false,
    raw: {},
    ...overrides,
  };
}

describe("World Championship candidate selection", () => {
  it("recognizes the canonical provider league and tournament ID", () => {
    expect(isWorldChampionshipCandidate(tournament({ leagueSlug: "worlds" }))).toBe(true);
    expect(isWorldChampionshipCandidate(tournament({ providerId: "lol-worlds_2026" }))).toBe(true);
  });

  it("excludes adjacent events that are not the championship", () => {
    expect(isWorldChampionshipCandidate(tournament({ name: "Worlds Qualifying Series 2026" }))).toBe(false);
    expect(isWorldChampionshipCandidate(tournament({ name: "Esports World Cup", leagueSlug: "worlds" }))).toBe(false);
  });

  it("returns only Worlds candidates with newest events first", () => {
    const selected = selectWorldChampionshipCandidates([
      tournament({ providerId: "lcs", name: "LCS 2026", leagueSlug: "lcs" }),
      tournament({ providerId: "worlds-2025", name: "Worlds 2025", startTime: "2025-10-01T00:00:00Z" }),
      tournament({ providerId: "worlds-2026", name: "Worlds 2026", startTime: "2026-10-01T00:00:00Z" }),
    ]);
    expect(selected.map((entry) => entry.providerId)).toEqual(["worlds-2026", "worlds-2025"]);
  });
});
