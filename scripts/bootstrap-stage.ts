import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { runStageBootstrap } from "../src/lib/stages/bootstrap-runner";

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required.");
  const sql = createDatabase(env.DATABASE_URL);
  try {
    const result = await runStageBootstrap(
      sql,
      new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY, minRequestIntervalMs: 6_100 }),
      {
        tournamentId: args.required("tournament"),
        slug: args.required("stage"),
        name: args.required("name"),
        lockAt: args.required("lock-at"),
        eligibleTeamIds: args.optional("teams")?.split(","),
      },
      (message) => console.info(message),
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
