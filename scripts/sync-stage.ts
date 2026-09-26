import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { synchronizeStage } from "../src/lib/stages/sync";

function booleanFlag(value: string | undefined, name: string) {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required for stage synchronization.");
  const matchIds = flags.optional("matches")?.split(",").map((value) => value.trim()).filter(Boolean);
  const sql = createDatabase(env.DATABASE_URL);
  try {
    const result = await synchronizeStage(
      sql,
      new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY, minRequestIntervalMs: 6_100 }),
      {
        stageSlug: flags.required("stage"),
        matchIds,
        refreshCompleted: booleanFlag(flags.optional("refresh-completed"), "refresh-completed"),
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
