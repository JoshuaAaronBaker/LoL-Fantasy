import type { TournamentCatalogEntry } from "@/lib/domain/types";

const excludedWorldsEvents = /qualifying series|esports world cup|world championship series/i;

export function isWorldChampionshipCandidate(tournament: TournamentCatalogEntry) {
  const league = tournament.leagueSlug?.toLowerCase().replaceAll("_", "-") ?? "";
  const name = tournament.name.toLowerCase();
  const providerId = tournament.providerId.toLowerCase();
  const belongsToWorlds = league === "worlds" || league === "lol-worlds"
    || /\bworlds\b|world championship/.test(name)
    || /(^|[-_])worlds(?:[-_]|$)/.test(providerId);
  return belongsToWorlds && !excludedWorldsEvents.test(tournament.name);
}

export function selectWorldChampionshipCandidates(tournaments: TournamentCatalogEntry[]) {
  return tournaments.filter(isWorldChampionshipCandidate).sort((left, right) => {
    const leftTime = left.startTime ? new Date(left.startTime).valueOf() : 0;
    const rightTime = right.startTime ? new Date(right.startTime).valueOf() : 0;
    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
}
