export const PRO_ROLES = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"] as const;
export type ProRole = (typeof PRO_ROLES)[number];

export type SourceKind = "fixture" | "live";

export interface NormalizedTournament {
  provider: "cito";
  providerId: string;
  name: string;
  startTime: string | null;
  endTime: string | null;
  raw: unknown;
}

export interface NormalizedTeam {
  provider: "cito";
  providerId: string;
  name: string;
  abbreviation: string | null;
  raw: unknown;
}

export interface NormalizedPlayer {
  provider: "cito";
  providerId: string;
  displayName: string;
  role: ProRole | null;
  teamProviderId: string;
  raw: unknown;
}

export interface NormalizedMatch {
  provider: "cito";
  providerId: string;
  tournamentProviderId: string;
  stageLabel: string | null;
  startTime: string | null;
  status: string;
  teams: NormalizedTeam[];
  raw: unknown;
}

export interface NormalizedGame {
  provider: "cito";
  providerId: string;
  matchProviderId: string;
  gameNumber: number | null;
  status: string;
  winnerTeamProviderId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  raw: unknown;
}

export interface NormalizedPlayerGameStat {
  provider: "cito";
  player: NormalizedPlayer;
  team: NormalizedTeam;
  role: ProRole | null;
  providerRole: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  won: boolean;
  raw: unknown;
}

export interface NormalizedGameWithStats {
  game: NormalizedGame;
  stats: NormalizedPlayerGameStat[];
  statsRaw: unknown;
}

export interface IngestionBundle {
  tournament: NormalizedTournament;
  match: NormalizedMatch;
  games: NormalizedGameWithStats[];
}
