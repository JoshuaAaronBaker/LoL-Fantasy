import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameSchema, usernameToInternalEmail } from "./credentials";

describe("username credentials", () => {
  it("normalizes usernames for identity comparisons", () => {
    expect(normalizeUsername("  Faker_1 ")).toBe("faker_1");
    expect(usernameToInternalEmail("Faker_1")).toBe("faker_1@users.lolfantasy.invalid");
  });

  it("accepts only the documented username format", () => {
    expect(usernameSchema.safeParse("Caps_123").success).toBe(true);
    expect(usernameSchema.safeParse("no spaces").success).toBe(false);
    expect(usernameSchema.safeParse("ab").success).toBe(false);
  });
});

