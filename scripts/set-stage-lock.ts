import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { parseFlags } from "../src/lib/cli/arguments";

const args = parseFlags(process.argv.slice(2));
const slug = args.required("stage");
const lockAt = new Date(args.required("lock-at"));
if (Number.isNaN(lockAt.valueOf()) || lockAt <= new Date()) throw new Error("--lock-at must be a future ISO timestamp.");
const sql = createDatabase(getServerEnv().DATABASE_URL);
try {
  const rows = await sql<Array<{ id: string; name: string; roster_lock_time: string }>>`
    update tournament_stages
    set roster_lock_time = ${lockAt.toISOString()}
    where slug = ${slug} and status in ('UPCOMING', 'OPEN')
      and (roster_lock_time is null or clock_timestamp() < roster_lock_time)
    returning id, name, roster_lock_time::text
  `;
  if (rows.length !== 1) throw new Error(`No single unlocked stage found for slug ${slug}.`);
  console.log(JSON.stringify(rows[0], null, 2));
} finally {
  await sql.end();
}

