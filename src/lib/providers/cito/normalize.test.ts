import { describe, expect, it } from "vitest";
import {
  canonicalRole,
  normalizeGame,
  normalizePlayerAggregateStats,
  normalizePlayerStats,
  normalizeTeamRoster,
  normalizeTournamentTeams,
  normalizeTournamentCatalog,
} from "./normalize";

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
              visionScore: 24,
            },
          ],
        },
      },
      game,
    );
    expect(stats[0]).toMatchObject({
      kills: 8,
      deaths: 2,
      assists: 11,
      cs: 287,
      visionScore: 24,
      won: true,
      role: "MID",
    });
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

  it("discovers unique tournament teams and ignores TBD placeholders", () => {
    const teams = normalizeTournamentTeams({ matches: [
      { team1: { slug: "c9", name: "Cloud9", logoUrl: "https://example.com/c9.png" }, team2: { slug: "tbd", name: "TBD" } },
      { team1: { slug: "c9", name: "Cloud9" }, team2: { slug: "fly", name: "FlyQuest" } },
    ] });
    expect(teams.map(({ team }) => team.providerId)).toEqual(["c9", "fly"]);
    expect(teams[0].team.imageUrl).toBe("https://example.com/c9.png");
  });

  it("normalizes roster freshness, starters, images, and aggregate stats", () => {
    const roster = normalizeTeamRoster({
      team: { slug: "sr", name: "Shopify Rebellion" },
      rosterStatus: { status: "stale", message: "Old roster", lastCheckedAt: "2026-08-01T00:00:00Z" },
      data: [{
        lolPlayerId: "player-1", role: "ADC", isStarter: true, isActive: true,
        imageUrl: "https://example.com/player.png", player: { currentIgn: "Carry" },
      }],
    }, "sr");
    expect(roster).toMatchObject({
      status: "stale",
      players: [{ role: "BOT", isStarter: true, isActive: true, player: { displayName: "Carry" } }],
    });
    expect(normalizePlayerAggregateStats({
      gamesPlayed: 10,
      wins: 6,
      avgKills: 4,
      avgDeaths: 2,
      avgAssists: 7,
      avgCs: 250,
      avgVisionScore: 80,
    })).toMatchObject({
      gamesPlayed: 10,
      wins: 6,
      winRate: 0,
      avgKills: 4,
      avgCs: 250,
      avgVisionScore: 80,
    });
  });

  it("normalizes the paginated tournament catalog", () => {
    const catalog = normalizeTournamentCatalog({
      tournaments: [{
        tournamentId: "lol-worlds_2026",
        name: "Worlds 2026",
        league: { name: "World Championship", slug: "worlds" },
        startDate: "2026-10-20T00:00:00Z",
        endDate: "2026-11-20T00:00:00Z",
        isInternational: true,
      }],
    });
    expect(catalog).toEqual([expect.objectContaining({
      providerId: "lol-worlds_2026",
      name: "Worlds 2026",
      leagueName: "World Championship",
      leagueSlug: "worlds",
      isInternational: true,
      startTime: "2026-10-20T00:00:00.000Z",
    })]);
  });
});
