import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { parseFlags } from "../src/lib/cli/arguments";
import { recalculateRosterScores } from "../src/lib/leaderboard/repository";

const flags = parseFlags(process.argv.slice(2));
const stageSlug = flags.optional("stage");
const sql = createDatabase(getServerEnv().DATABASE_URL);
try {
  let stageId: string | undefined;
  if (stageSlug) {
    const stages = await sql<Array<{ id: string }>>`select id from tournament_stages where slug = ${stageSlug}`;
    if (stages.length !== 1) throw new Error(`Expected one stage with slug ${stageSlug}; found ${stages.length}.`);
    stageId = stages[0].id;
  }
  console.log(JSON.stringify(await recalculateRosterScores(sql, stageId), null, 2));
} finally {
  await sql.end();
}

