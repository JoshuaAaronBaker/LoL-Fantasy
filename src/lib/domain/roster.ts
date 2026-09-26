import { PRO_ROLES, type ProRole } from "./types";

export interface RosterCatalogPlayer {
  id: string;
  teamId: string;
  role: ProRole;
  price: number;
  eligible: boolean;
}

export interface RosterSelection {
  playerIds: string[];
  captainPlayerId: string;
}

export interface RosterValidationOptions {
  salaryCap: number;
  maxPlayersPerTeam: number;
}

export interface RosterValidationResult {
  valid: boolean;
  totalSalary: number;
  errors: string[];
}

export function isRosterStageOpen(status: string, databaseNow: string, lockAt: string | null) {
  return status === "OPEN" && lockAt !== null && new Date(databaseNow).valueOf() < new Date(lockAt).valueOf();
}

export function validateRoster(
  selection: RosterSelection,
  catalog: RosterCatalogPlayer[],
  options: RosterValidationOptions,
): RosterValidationResult {
  const errors: string[] = [];
  const uniqueIds = new Set(selection.playerIds);
  if (selection.playerIds.length !== 5 || uniqueIds.size !== 5) {
    errors.push("Select exactly five unique players.");
  }

  const byId = new Map(catalog.map((player) => [player.id, player]));
  const selected = [...uniqueIds].map((id) => byId.get(id)).filter((player) => player !== undefined);
  if (selected.length !== uniqueIds.size || selected.some((player) => !player.eligible)) {
    errors.push("Every selected player must be eligible for this stage.");
  }

  for (const role of PRO_ROLES) {
    if (selected.filter((player) => player.role === role).length !== 1) {
      errors.push(`Select exactly one ${role} player.`);
    }
  }

  const totalSalary = selected.reduce((total, player) => total + player.price, 0);
  if (totalSalary > options.salaryCap) errors.push("The lineup exceeds the salary cap.");

  const teamCounts = new Map<string, number>();
  for (const player of selected) teamCounts.set(player.teamId, (teamCounts.get(player.teamId) ?? 0) + 1);
  if ([...teamCounts.values()].some((count) => count > options.maxPlayersPerTeam)) {
    errors.push(`Select no more than ${options.maxPlayersPerTeam} players from one team.`);
  }

  if (!uniqueIds.has(selection.captainPlayerId)) errors.push("Choose a captain from your lineup.");
  return { valid: errors.length === 0, totalSalary, errors };
}
