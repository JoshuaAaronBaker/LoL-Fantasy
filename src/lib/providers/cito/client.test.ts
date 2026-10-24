import { describe, expect, it, vi } from "vitest";
import { CitoApiError, CitoEsportsDataProvider } from "./client";

describe("Cito client", () => {
  it("keeps the API key in the server request header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "worlds-2026", name: "Worlds 2026" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new CitoEsportsDataProvider({ apiKey: "secret-test-key", fetchImpl });

    await provider.getTournament("worlds-2026");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.headers).toMatchObject({ "x-api-key": "secret-test-key" });
  });

  it("retries a rate limit and then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "worlds-2026", name: "Worlds 2026" }), { status: 200 }),
      );
    const provider = new CitoEsportsDataProvider({ apiKey: "key", fetchImpl, maxRetries: 1 });

    await expect(provider.getTournament("worlds-2026")).resolves.toMatchObject({ providerId: "worlds-2026" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry an authentication failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const provider = new CitoEsportsDataProvider({ apiKey: "bad-key", fetchImpl, maxRetries: 3 });

    await expect(provider.getTournament("worlds-2026")).rejects.toEqual(expect.any(CitoApiError));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry a rate limit that cannot clear during the worker run", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("monthly limit reached", { status: 429, headers: { "retry-after": "3600" } }),
    );
    const provider = new CitoEsportsDataProvider({ apiKey: "key", fetchImpl, maxRetries: 3 });

    await expect(provider.getTournament("worlds-2026")).rejects.toEqual(expect.any(CitoApiError));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("loads a bounded tournament catalog page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      tournaments: [{ tournamentId: "lol-worlds_2026", name: "Worlds 2026", league: { slug: "worlds" } }],
    }), { status: 200 }));
    const provider = new CitoEsportsDataProvider({ apiKey: "key", fetchImpl });

    await expect(provider.getTournaments()).resolves.toEqual([
      expect.objectContaining({ providerId: "lol-worlds_2026", leagueSlug: "worlds" }),
    ]);
    expect(fetchImpl.mock.calls[0][0]).toContain("/lol/tournaments?limit=100&offset=0");
  });

  it("enriches incomplete final Cito stats from Riot's official live-stat feed", async () => {
    const citoStats = Array.from({ length: 10 }, (_, index) => ({
      player: { id: `player-${index + 1}`, displayName: `Player${index + 1}` },
      team: { id: index < 5 ? "blue" : "red", name: index < 5 ? "Blue" : "Red" },
      role: ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"][index % 5],
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      visionScore: null,
    }));
    const metadata = (offset: number) => Array.from({ length: 5 }, (_, index) => ({
      participantId: offset + index + 1,
      summonerName: `${offset ? "RED" : "BLU"} Player${offset + index + 1}`,
    }));
    const finalParticipants = Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1,
      kills: index,
      deaths: 1,
      assists: 10 - index,
      creepScore: 200 + index,
      wardsPlaced: 20 + index,
      wardsDestroyed: 5,
    }));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: citoStats }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        gameMetadata: {
          blueTeamMetadata: { participantMetadata: metadata(0) },
          redTeamMetadata: { participantMetadata: metadata(5) },
        },
        frames: [{ rfc460Timestamp: "2026-10-23T17:00:00.000Z" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        frames: [{ rfc460Timestamp: "2026-10-23T17:31:00.000Z", participants: finalParticipants }],
      }), { status: 200 }));
    const provider = new CitoEsportsDataProvider({ apiKey: "key", fetchImpl });

    const result = await provider.getGamePlayerStats({
      provider: "cito",
      providerId: "lol-game-123",
      matchProviderId: "lol-match-123",
      gameNumber: 1,
      status: "COMPLETED",
      winnerTeamProviderId: "red",
      startedAt: null,
      endedAt: null,
      raw: { duration: 1_800 },
    });

    expect(result.stats[0]).toMatchObject({ kills: 0, deaths: 1, assists: 10, cs: 200, visionScore: 25 });
    expect(result.stats[9]).toMatchObject({ kills: 9, deaths: 1, assists: 1, cs: 209, visionScore: 34 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[1][0])).toContain("feed.lolesports.com/livestats/v1/window/123");
    const detailsUrl = new URL(String(fetchImpl.mock.calls[2][0]));
    expect(detailsUrl.searchParams.get("startingTime")).toBe("2026-10-23T17:00:00.000Z");
  });
});
