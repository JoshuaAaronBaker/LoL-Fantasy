import type {
  NormalizedGame,
  NormalizedMatch,
  NormalizedPlayerGameStat,
  NormalizedTournament,
  PlayerAggregateStats,
  TeamRoster,
  TournamentTeam,
} from "@/lib/domain/types";

export interface PlayerStatsResult {
  stats: NormalizedPlayerGameStat[];
  raw: unknown;
}

export interface EsportsDataProvider {
  readonly name: "cito";
  getTournament(tournamentId: string): Promise<NormalizedTournament>;
  getTournamentTeams(tournamentId: string): Promise<TournamentTeam[]>;
  getTeamRoster(teamId: string): Promise<TeamRoster>;
  getPlayerAggregateStats(playerId: string): Promise<PlayerAggregateStats>;
  getMatch(matchId: string, tournamentId: string): Promise<NormalizedMatch>;
  getMatchGames(matchId: string): Promise<NormalizedGame[]>;
  getGame(gameId: string, matchId: string): Promise<NormalizedGame>;
  getGamePlayerStats(game: NormalizedGame): Promise<PlayerStatsResult>;
}
