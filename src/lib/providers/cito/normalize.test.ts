import { describe, expect, it } from "vitest";
import { canonicalRole, normalizeGame, normalizePlayerStats } from "./normalize";

describe("Cito normalization", () => {
  it.each([
    ["Top Lane", "TOP"],
    ["jg", "JUNGLE"],
    ["middle", "MID"],
    ["ADC", "BOT"],
    ["sup", "SUPPORT"],
    ["coach", null],
  ])("maps role %s", (input, expected) => expect(canonicalRole(input)).toBe(expected));

  it("unwraps payloads and derives a win from the game winner", () => {
    const game = normalizeGame(
      { data: { gameId: "game-1", matchId: "match-1", status: "complete", winnerTeamId: "team-1" } },
      "match-1",
    );
    const stats = normalizePlayerStats(
      {
        data: {
          players: [
            {
              player: { id: "player-1", displayName: "Sample Mid" },
              team: { id: "team-1", name: "Sample Blue" },
              role: "MID",
              kills: 8,
              deaths: 2,
              assists: 11,
              cs: 287,
            },
          ],
        },
      },
      game,
    );
    expect(stats[0]).toMatchObject({ kills: 8, deaths: 2, assists: 11, cs: 287, won: true, role: "MID" });
  });
});
