import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { parseFlags } from "../src/lib/cli/arguments";
import { recalculateRosterScores } from "../src/lib/leaderboard/repository";

const flags = parseFlags(process.argv.slice(2));
const stageSlug = flags.required("stage");
const matchIds = flags.required("matches").split(",").map((value) => value.trim()).filter(Boolean);
if (matchIds.length === 0 || new Set(matchIds).size !== matchIds.length) {
  throw new Error("--matches must contain one or more unique comma-separated provider match IDs.");
}

const sql = createDatabase(getServerEnv().DATABASE_URL);
try {
  const result = await sql.begin(async (tx) => {
    const stages = await tx<Array<{ id: string; tournament_id: string; name: string }>>`
      select id, tournament_id, name from tournament_stages where slug = ${stageSlug} for update
    `;
    if (stages.length !== 1) throw new Error(`Expected one stage with slug ${stageSlug}; found ${stages.length}.`);
    const stage = stages[0];
    const matches = await tx<Array<{ id: string; provider_id: string; stage_id: string | null }>>`
      select id, provider_id, stage_id from matches
      where provider = 'cito' and provider_id in ${tx(matchIds)} and tournament_id = ${stage.tournament_id}
      for update
    `;
    const found = new Set(matches.map((match) => match.provider_id));
    const missing = matchIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new Error(`Matches are missing or belong to another tournament: ${missing.join(", ")}.`);
    const conflicts = matches.filter((match) => match.stage_id && match.stage_id !== stage.id);
    if (conflicts.length > 0) throw new Error(`Matches already belong to another stage: ${conflicts.map((match) => match.provider_id).join(", ")}.`);

    await tx`update matches set stage_id = ${stage.id} where id in ${tx(matches.map((match) => match.id))}`;
    const scoring = await recalculateRosterScores(tx, stage.id);
    return { stageId: stage.id, stageName: stage.name, matches: matchIds, scoring };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}

