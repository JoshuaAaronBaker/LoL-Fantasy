import type { EsportsDataProvider } from "@/lib/providers/esports-data-provider";
import type { IngestionBundle } from "@/lib/domain/types";

export interface LoadMatchOptions {
  tournamentId: string;
  matchId: string;
  gameId?: string;
}

export async function loadCompletedMatch(
  provider: EsportsDataProvider,
  options: LoadMatchOptions,
): Promise<IngestionBundle> {
  // These calls are intentionally sequential to stay within low-volume provider plans.
  const tournament = await provider.getTournament(options.tournamentId);
  const match = await provider.getMatch(options.matchId, options.tournamentId);
  const listedGames = await provider.getMatchGames(options.matchId);

  const selected = options.gameId
    ? listedGames.filter((game) => game.providerId === options.gameId)
    : listedGames.filter((game) => ["COMPLETE", "COMPLETED", "FINISHED"].includes(game.status));

  if (selected.length === 0) {
    throw new Error(
      options.gameId
        ? `Game ${options.gameId} was not found in match ${options.matchId}.`
        : `Match ${options.matchId} has no completed games to ingest.`,
    );
  }

  // Keep provider calls sequential. Cito's free tier is intentionally low-volume,
  // and parallel game/stat requests create a retry thundering herd at minute boundaries.
  const games: IngestionBundle["games"] = [];
  for (const listedGame of selected) {
    const game = await provider.getGame(listedGame.providerId, match.providerId);
    const result = await provider.getGamePlayerStats(game);
    games.push({ game, stats: result.stats, statsRaw: result.raw });
  }

  return { tournament, match, games };
}
