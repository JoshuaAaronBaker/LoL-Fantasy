import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { resetWorldsStagePricing } from "../src/lib/stages/reset-worlds-pricing";

const flags = parseFlags(process.argv.slice(2));
const stageSlug = flags.required("stage");
if (flags.required("confirm") !== stageSlug) {
  throw new Error("The --confirm value must exactly match --stage.");
}

const sql = createDatabase(getServerEnv().DATABASE_URL);
try {
  const result = await resetWorldsStagePricing(sql, stageSlug);
  console.info(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
