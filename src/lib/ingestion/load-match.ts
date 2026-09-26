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
  const [tournament, match, listedGames] = await Promise.all([
    provider.getTournament(options.tournamentId),
    provider.getMatch(options.matchId, options.tournamentId),
    provider.getMatchGames(options.matchId),
  ]);

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

  const games = await Promise.all(
    selected.map(async (listedGame) => {
      const game = await provider.getGame(listedGame.providerId, match.providerId);
      const result = await provider.getGamePlayerStats(game);
      return { game, stats: result.stats, statsRaw: result.raw };
    }),
  );

  return { tournament, match, games };
}
