import { describe, expect, it } from "vitest";
import { getWorldsPlayerRanking } from "./worlds-player-rankings";

describe("Worlds player rankings", () => {
  it("uses the supplied absolute top-lane order", () => {
    expect(getWorldsPlayerRanking("TOP", "Zeus")).toMatchObject({ rank: 1, fieldSize: 21 });
    expect(getWorldsPlayerRanking("TOP", "369")).toMatchObject({ rank: 14, fieldSize: 21 });
    expect(getWorldsPlayerRanking("TOP", "Zest")).toMatchObject({ rank: 19, fieldSize: 21 });
    expect(getWorldsPlayerRanking("TOP", "Zuian")).toBeNull();
  });

  it("matches harmless provider formatting differences", () => {
    expect(getWorldsPlayerRanking("BOT", "HansSama")).toMatchObject({ rank: 6 });
    expect(getWorldsPlayerRanking("JUNGLE", "skewmond")).toMatchObject({ rank: 6 });
  });
});
