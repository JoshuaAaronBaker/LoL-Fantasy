import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { recalculateScores } from "../src/lib/ingestion/repository";
import { createDatabase } from "../src/lib/db/connect";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const flags = parseFlags(process.argv.slice(2));
  const sql = createDatabase(databaseUrl);
  try {
    const result = await recalculateScores(
      sql,
      flags.optional("ruleset") ?? "default-v2",
      flags.optional("game"),
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
