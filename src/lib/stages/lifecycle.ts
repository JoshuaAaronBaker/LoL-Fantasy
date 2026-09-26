export const STAGE_STATUSES = ["UPCOMING", "OPEN", "LOCKED", "LIVE", "COMPLETE"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

const statusRank = new Map(STAGE_STATUSES.map((status, index) => [status, index]));

function canonicalProviderStatus(status: string) {
  return status.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

const TERMINAL_MATCH_STATUSES = new Set([
  "COMPLETE",
  "COMPLETED",
  "FINISHED",
  "FINAL",
  "CANCELLED",
  "CANCELED",
  "FORFEIT",
  "FORFEITED",
]);

const LIVE_MATCH_STATUSES = new Set([
  "ACTIVE",
  "IN_PROGRESS",
  "LIVE",
  "RUNNING",
  "STARTED",
]);

const COMPLETED_GAME_STATUSES = new Set(["COMPLETE", "COMPLETED", "FINISHED", "FINAL"]);

export function isTerminalMatchStatus(status: string) {
  return TERMINAL_MATCH_STATUSES.has(canonicalProviderStatus(status));
}

export function isLiveMatchStatus(status: string) {
  return LIVE_MATCH_STATUSES.has(canonicalProviderStatus(status));
}

export function isCompletedGameStatus(status: string) {
  return COMPLETED_GAME_STATUSES.has(canonicalProviderStatus(status));
}

export interface StageLifecycleInput {
  currentStatus: StageStatus;
  databaseNow: string;
  lockAt: string;
  matchStatuses: string[];
  completedGames: number;
}

export function determineStageStatus(input: StageLifecycleInput): StageStatus {
  if (input.currentStatus === "COMPLETE") return "COMPLETE";

  const now = new Date(input.databaseNow).valueOf();
  const lockAt = new Date(input.lockAt).valueOf();
  if (!Number.isFinite(now) || !Number.isFinite(lockAt)) {
    throw new Error("Stage lifecycle requires valid database and lock timestamps.");
  }

  let desired: StageStatus;
  if (now < lockAt) {
    desired = "OPEN";
  } else if (
    input.matchStatuses.length > 0
    && input.matchStatuses.every(isTerminalMatchStatus)
  ) {
    desired = "COMPLETE";
  } else if (
    input.completedGames > 0
    || input.matchStatuses.some((status) => isLiveMatchStatus(status) || isTerminalMatchStatus(status))
  ) {
    desired = "LIVE";
  } else {
    desired = "LOCKED";
  }

  return (statusRank.get(desired) ?? 0) > (statusRank.get(input.currentStatus) ?? 0)
    ? desired
    : input.currentStatus;
}
