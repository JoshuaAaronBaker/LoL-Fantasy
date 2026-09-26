import { describe, expect, it } from "vitest";
import { PRO_ROLES } from "./types";
import { isRosterStageOpen, validateRoster, type RosterCatalogPlayer } from "./roster";

const catalog: RosterCatalogPlayer[] = PRO_ROLES.map((role, index) => ({
  id: role,
  teamId: `team-${index % 3}`,
  role,
  price: 10_000_000,
  eligible: true,
}));

describe("roster validation", () => {
  it("locks at the exact database timestamp", () => {
    expect(isRosterStageOpen("OPEN", "2026-09-26T10:00:00.000Z", "2026-09-26T10:00:00.001Z")).toBe(true);
    expect(isRosterStageOpen("OPEN", "2026-09-26T10:00:00.000Z", "2026-09-26T10:00:00.000Z")).toBe(false);
    expect(isRosterStageOpen("LOCKED", "2026-09-26T09:00:00.000Z", "2026-09-26T10:00:00.000Z")).toBe(false);
  });
  it("accepts a complete legal lineup", () => {
    const result = validateRoster(
      { playerIds: [...PRO_ROLES], captainPlayerId: "MID" },
      catalog,
      { salaryCap: 50_000_000, maxPlayersPerTeam: 2 },
    );
    expect(result).toEqual({ valid: true, totalSalary: 50_000_000, errors: [] });
  });

  it("rejects duplicates, missing roles, overspend, team stacking, ineligible players, and outsider captains", () => {
    const invalidCatalog = catalog.map((player) => ({
      ...player,
      teamId: "one-team",
      price: 11_000_000,
      eligible: player.id !== "TOP",
    }));
    const result = validateRoster(
      { playerIds: ["TOP", "TOP", "MID", "BOT", "SUPPORT"], captainPlayerId: "outsider" },
      invalidCatalog,
      { salaryCap: 50_000_000, maxPlayersPerTeam: 2 },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/five unique|eligible|JUNGLE|salary|no more than|captain/i);
  });
});
