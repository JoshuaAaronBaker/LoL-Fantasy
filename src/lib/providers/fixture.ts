import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { EsportsDataProvider, PlayerStatsResult } from "./esports-data-provider";
import type { NormalizedGame, PlayerAggregateStats, TeamRoster, TournamentCatalogEntry, TournamentTeam } from "@/lib/domain/types";
import {
  normalizeGame,
  normalizeGames,
  normalizeMatch,
  normalizePlayerStats,
  normalizeTournament,
} from "./cito/normalize";

const fixtureSchema = z.object({
  fixture: z.literal(true),
  label: z.string(),
  tournament: z.unknown(),
  match: z.unknown(),
  games: z.unknown(),
  gameDetails: z.record(z.string(), z.unknown()),
  gameStats: z.record(z.string(), z.unknown()),
});

type FixtureDocument = z.infer<typeof fixtureSchema>;

export class FixtureEsportsDataProvider implements EsportsDataProvider {
  readonly name = "cito" as const;

  constructor(readonly document: FixtureDocument) {}

  static async fromFile(path: string) {
    const contents = await readFile(path, "utf8");
    return new FixtureEsportsDataProvider(fixtureSchema.parse(JSON.parse(contents)));
  }

  async getTournaments(): Promise<TournamentCatalogEntry[]> {
    throw new Error("The completed-match fixture does not include a tournament catalog.");
  }

  async getTournament() {
    return normalizeTournament(this.document.tournament);
  }

  async getTournamentTeams(): Promise<TournamentTeam[]> {
    throw new Error("The completed-match fixture does not include a tournament team catalog.");
  }

  async getTeamRoster(): Promise<TeamRoster> {
    throw new Error("The completed-match fixture does not include team rosters.");
  }

  async getPlayerAggregateStats(): Promise<PlayerAggregateStats> {
    throw new Error("The completed-match fixture does not include aggregate player stats.");
  }

  async getMatch(_matchId: string, tournamentId: string) {
    return normalizeMatch(this.document.match, tournamentId);
  }

  async getMatchGames(matchId: string) {
    return normalizeGames(this.document.games, matchId);
  }

  async getGame(gameId: string, matchId: string) {
    const value = this.document.gameDetails[gameId];
    if (!value) throw new Error(`Fixture has no game detail for ${gameId}.`);
    return normalizeGame(value, matchId);
  }

  async getGamePlayerStats(game: NormalizedGame): Promise<PlayerStatsResult> {
    const raw = this.document.gameStats[game.providerId];
    if (!raw) throw new Error(`Fixture has no player stats for ${game.providerId}.`);
    return { stats: normalizePlayerStats(raw, game), raw };
  }
}
