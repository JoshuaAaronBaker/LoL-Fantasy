import { describe, expect, it } from "vitest";
import { shouldFetchMatchGames, shouldPollMatch } from "./sync";

const now = "2026-10-23T17:00:00.000Z";

describe("stage synchronization request selection", () => {
  it("skips terminal matches unless a completed refresh is requested", () => {
    const match = { status: "COMPLETED", startTime: "2026-10-23T16:00:00.000Z", completedGames: 1 };

    expect(shouldPollMatch(match, now)).toBe(false);
    expect(shouldPollMatch(match, now, true)).toBe(true);
  });

  it("keeps polling a terminal match until its completed game is stored", () => {
    expect(shouldPollMatch({
      status: "COMPLETED",
      startTime: "2026-10-23T16:00:00.000Z",
      completedGames: 0,
    }, now)).toBe(true);
  });

  it("defers scheduled matches outside the polling lead window", () => {
    expect(shouldPollMatch({
      status: "UNSTARTED",
      startTime: "2026-10-23T19:00:01.000Z",
    }, now)).toBe(false);
    expect(shouldPollMatch({
      status: "UNSTARTED",
      startTime: "2026-10-23T18:30:00.000Z",
    }, now)).toBe(true);
  });

  it("polls live and previously unknown matches immediately", () => {
    expect(shouldPollMatch({ status: "LIVE", startTime: null }, now)).toBe(true);
    expect(shouldPollMatch(undefined, now)).toBe(true);
  });

  it("avoids game-list requests until a match leaves its scheduled state", () => {
    expect(shouldFetchMatchGames("SCHEDULED")).toBe(false);
    expect(shouldFetchMatchGames("UNSTARTED")).toBe(false);
    expect(shouldFetchMatchGames("LIVE")).toBe(true);
    expect(shouldFetchMatchGames("COMPLETED")).toBe(true);
  });
});
