import { describe, expect, it } from "vitest";
import type { TournamentTeam } from "@/lib/domain/types";
import { selectStageTeams } from "./team-eligibility";

const teams: TournamentTeam[] = ["t1", "gen", "fly"].map((providerId) => ({
  team: {
    provider: "cito",
    providerId,
    name: providerId.toUpperCase(),
    abbreviation: providerId.toUpperCase(),
    raw: {},
  },
  raw: {},
}));

describe("stage team eligibility", () => {
  it("keeps tournament order when no explicit field is supplied", () => {
    expect(selectStageTeams(teams).map((team) => team.team.providerId)).toEqual(["t1", "gen", "fly"]);
  });

  it("returns only the operator-confirmed surviving teams in requested order", () => {
    expect(selectStageTeams(teams, ["GEN", "t1"]).map((team) => team.team.providerId)).toEqual(["gen", "t1"]);
  });

  it("rejects duplicates and teams outside the tournament", () => {
    expect(() => selectStageTeams(teams, ["t1", "T1"])).toThrow(/unique/i);
    expect(() => selectStageTeams(teams, ["missing"])).toThrow(/not found/i);
  });
});
