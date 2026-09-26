import type { TournamentTeam } from "@/lib/domain/types";

export function selectStageTeams(teams: TournamentTeam[], requestedProviderIds?: string[]) {
  if (!requestedProviderIds) return teams;
  const requested = requestedProviderIds.map((value) => value.trim()).filter(Boolean);
  const normalized = requested.map((value) => value.toLowerCase());
  if (requested.length === 0) throw new Error("At least one eligible team is required.");
  if (new Set(normalized).size !== normalized.length) throw new Error("Eligible team IDs must be unique.");

  const byProviderId = new Map(teams.map((team) => [team.team.providerId.toLowerCase(), team]));
  const missing = requested.filter((_, index) => !byProviderId.has(normalized[index]));
  if (missing.length > 0) {
    throw new Error(`Eligible teams were not found in the tournament: ${missing.join(", ")}.`);
  }
  return normalized.map((providerId) => byProviderId.get(providerId)!);
}
