import "dotenv/config";
import { resolve } from "node:path";
import { FixtureEsportsDataProvider } from "../src/lib/providers/fixture";
import { loadCompletedMatch } from "../src/lib/ingestion/load-match";
import { persistIngestionBundle } from "../src/lib/ingestion/repository";
import { createDatabase } from "../src/lib/db/connect";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required. Copy .env.example to .env first.");
  const fixturePath = resolve(process.cwd(), "fixtures/cito/completed-match.json");
  const provider = await FixtureEsportsDataProvider.fromFile(fixturePath);
  const sql = createDatabase(databaseUrl);
  try {
    const bundle = await loadCompletedMatch(provider, {
      tournamentId: "sample-worlds-2026",
      matchId: "sample-match-1",
    });
    const result = await persistIngestionBundle(sql, bundle, "fixture");
    console.table(
      bundle.games.flatMap(({ game, stats }) =>
        stats.map((stat) => ({
          game: game.providerId,
          player: stat.player.displayName,
          kda: `${stat.kills}/${stat.deaths}/${stat.assists}`,
          cs: stat.cs,
        })),
      ),
    );
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
