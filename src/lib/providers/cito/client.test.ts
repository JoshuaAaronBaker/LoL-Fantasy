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
});
