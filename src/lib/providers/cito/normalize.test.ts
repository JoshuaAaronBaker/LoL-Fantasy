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

  it("normalizes the completed-game shape returned by Cito", () => {
    const game = normalizeGame(
      {
        gameId: "lol-game-1",
        matchId: "lol-match-1",
        gameNumber: 1,
        winnerSlug: "fly",
        statsStatus: "final",
        statsSettled: true,
      },
      "lol-match-1",
    );
    const stats = normalizePlayerStats(
      {
        success: true,
        data: [
          {
            playerName: "Example",
            player: { lolPlayerId: "player-uuid", currentIgn: "Example" },
            teamSlug: "fly",
            teamName: "FlyQuest",
            team: { slug: "fly", name: "FlyQuest", shortName: "FLY" },
            role: "ADC",
            kills: 5,
            deaths: 1,
            assists: 7,
            cs: 300,
          },
        ],
      },
      game,
    );

    expect(game).toMatchObject({ status: "COMPLETED", winnerTeamProviderId: "fly" });
    expect(stats[0]).toMatchObject({
      player: { providerId: "player-uuid", displayName: "Example" },
      team: { providerId: "fly", abbreviation: "FLY" },
      role: "BOT",
      won: true,
    });
  });
});
