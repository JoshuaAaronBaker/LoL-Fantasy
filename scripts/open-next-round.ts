import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { openNextRoundFromStage } from "../src/lib/stages/rollover";

const flags = parseFlags(process.argv.slice(2));
const sql = createDatabase(getServerEnv().DATABASE_URL);

try {
  const stages = await sql<Array<{ id: string }>>`
    select id from tournament_stages where slug = ${flags.required("from-stage")}
  `;
  if (stages.length !== 1) throw new Error("The source stage slug must resolve to exactly one stage.");
  const result = await openNextRoundFromStage(sql, {
    sourceStageId: stages[0].id,
    slug: flags.required("stage"),
    name: flags.required("name"),
    lockAt: flags.required("lock-at"),
    eligibleTeamProviderIds: flags.required("teams").split(","),
  });
  console.info(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
