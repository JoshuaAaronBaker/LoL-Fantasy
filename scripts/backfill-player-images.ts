import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { backfillCatalogPlayerImages } from "../src/lib/players/image-backfill";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required to backfill player images.");

  const databaseEndpoint = new URL(env.DATABASE_URL);
  console.info(JSON.stringify({ databaseHost: databaseEndpoint.hostname }));
  const sql = createDatabase(env.DATABASE_URL);
  try {
    const result = await backfillCatalogPlayerImages(
      sql,
      new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY, minRequestIntervalMs: 6_100 }),
      {
        stageSlug: flags.optional("stage"),
        progress: (message) => console.info(message),
      },
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
