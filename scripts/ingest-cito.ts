import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { loadCompletedMatch } from "../src/lib/ingestion/load-match";
import { persistIngestionBundle } from "../src/lib/ingestion/repository";
import { createDatabase } from "../src/lib/db/connect";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.CITO_API_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!apiKey) throw new Error("CITO_API_KEY is required for live ingestion.");
  const flags = parseFlags(process.argv.slice(2));
  const options = {
    tournamentId: flags.required("tournament"),
    matchId: flags.required("match"),
    gameId: flags.optional("game"),
  };
  const sql = createDatabase(databaseUrl);
  try {
    const bundle = await loadCompletedMatch(new CitoEsportsDataProvider({ apiKey }), options);
    const result = await persistIngestionBundle(sql, bundle, "live");
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
