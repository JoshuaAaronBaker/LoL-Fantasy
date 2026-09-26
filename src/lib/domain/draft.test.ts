import { describe, expect, it } from "vitest";
import { parseRosterDraft } from "./draft";

const catalog = [{ id: "top-1", role: "TOP" as const }, { id: "mid-1", role: "MID" as const }];

describe("roster drafts", () => {
  it("restores compatible selections and captain", () => {
    expect(parseRosterDraft(JSON.stringify({
      version: 1, selections: { TOP: "top-1", MID: "mid-1" }, captainPlayerId: "mid-1",
    }), catalog)).toEqual({
      version: 1, selections: { TOP: "top-1", MID: "mid-1" }, captainPlayerId: "mid-1",
    });
  });

  it("drops mismatched selections and incompatible versions", () => {
    expect(parseRosterDraft(JSON.stringify({
      version: 1, selections: { TOP: "mid-1", MID: "missing" }, captainPlayerId: "mid-1",
    }), catalog)).toEqual({ version: 1, selections: {}, captainPlayerId: null });
    expect(parseRosterDraft('{"version":2}', catalog)).toBeNull();
  });
});

