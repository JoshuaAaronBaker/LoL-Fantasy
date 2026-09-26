import { describe, expect, it } from "vitest";
import { determineStageStatus, isTerminalMatchStatus } from "./lifecycle";

const future = "2099-01-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";
const now = "2026-09-26T12:00:00.000Z";

describe("stage lifecycle", () => {
  it("keeps an open stage open before its exact lock time", () => {
    expect(determineStageStatus({
      currentStatus: "OPEN", databaseNow: now, lockAt: future,
      matchStatuses: ["COMPLETED"], completedGames: 1,
    })).toBe("OPEN");
  });

  it("locks at the lock timestamp when play has not started", () => {
    expect(determineStageStatus({
      currentStatus: "OPEN", databaseNow: past, lockAt: past,
      matchStatuses: ["SCHEDULED"], completedGames: 0,
    })).toBe("LOCKED");
  });

  it("moves from locked to live when play or completed games exist", () => {
    expect(determineStageStatus({
      currentStatus: "LOCKED", databaseNow: now, lockAt: past,
      matchStatuses: ["in progress", "SCHEDULED"], completedGames: 0,
    })).toBe("LIVE");
    expect(determineStageStatus({
      currentStatus: "LOCKED", databaseNow: now, lockAt: past,
      matchStatuses: ["UNKNOWN"], completedGames: 1,
    })).toBe("LIVE");
  });

  it("completes only after lock when every assigned match is terminal", () => {
    expect(determineStageStatus({
      currentStatus: "LIVE", databaseNow: now, lockAt: past,
      matchStatuses: ["completed", "FINAL"], completedGames: 5,
    })).toBe("COMPLETE");
    expect(determineStageStatus({
      currentStatus: "LIVE", databaseNow: now, lockAt: past,
      matchStatuses: ["COMPLETED", "SCHEDULED"], completedGames: 5,
    })).toBe("LIVE");
  });

  it("never moves a stage backward", () => {
    expect(determineStageStatus({
      currentStatus: "LIVE", databaseNow: now, lockAt: past,
      matchStatuses: ["SCHEDULED"], completedGames: 0,
    })).toBe("LIVE");
    expect(determineStageStatus({
      currentStatus: "COMPLETE", databaseNow: now, lockAt: future,
      matchStatuses: [], completedGames: 0,
    })).toBe("COMPLETE");
  });

  it.each(["complete", "COMPLETED", "final", "forfeited", "cancelled"])(
    "recognizes terminal provider status %s",
    (status) => expect(isTerminalMatchStatus(status)).toBe(true),
  );
});
