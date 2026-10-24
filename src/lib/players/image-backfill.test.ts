import { describe, expect, it } from "vitest";
import { normalizeImageMatchName } from "./image-backfill";

describe("player image backfill", () => {
  it.each([
    ["Gumayusi", "gumayusi"],
    ["Hans Sama", "hanssama"],
    ["SkewMond", "skewmond"],
    ["K'Sante", "ksante"],
  ])("normalizes %s for safe roster-name matching", (input, expected) => {
    expect(normalizeImageMatchName(input)).toBe(expected);
  });
});
