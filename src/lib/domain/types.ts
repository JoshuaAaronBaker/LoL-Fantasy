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
  imageUrl?: string | null;
  raw: unknown;
}

export interface NormalizedPlayer {
  provider: "cito";
  providerId: string;
  displayName: string;
  role: ProRole | null;
  teamProviderId: string;
  imageUrl?: string | null;
  raw: unknown;
}

export interface TournamentTeam {
  team: NormalizedTeam;
  raw: unknown;
}

export interface TeamRosterPlayer {
  player: NormalizedPlayer;
  role: ProRole | null;
  isStarter: boolean;
  isActive: boolean;
  raw: unknown;
}

export interface TeamRoster {
  team: NormalizedTeam;
  status: string | null;
  statusMessage: string | null;
  checkedAt: string | null;
  players: TeamRosterPlayer[];
  raw: unknown;
}

export interface PlayerAggregateStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCs: number;
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
