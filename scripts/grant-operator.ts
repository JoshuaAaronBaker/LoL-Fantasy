import "dotenv/config";
import { usernameSchema } from "../src/lib/auth/credentials";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const username = usernameSchema.parse(flags.required("username"));
  const sql = createDatabase(getServerEnv().DATABASE_URL);
  try {
    const profiles = await sql<Array<{ id: string; username: string }>>`
      select id, username from profiles where username_normalized = ${username.toLowerCase()}
    `;
    if (!profiles[0]) throw new Error(`No account exists for username ${username}.`);
    await sql`
      insert into fantasy_operators (user_id, granted_by)
      values (${profiles[0].id}, 'operator-cli')
      on conflict (user_id) do nothing
    `;
    console.info(JSON.stringify({ username: profiles[0].username, operator: true }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
