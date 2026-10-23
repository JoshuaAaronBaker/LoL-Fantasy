import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { passwordSchema, usernameSchema } from "../src/lib/auth/credentials";
import { parseFlags } from "../src/lib/cli/arguments";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const username = usernameSchema.parse(flags.required("username"));
  const password = passwordSchema.parse(process.env.OPERATOR_RESET_PASSWORD);
  const serviceRoleKey = z.string().min(1).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUrl = z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const sql = createDatabase(getServerEnv().DATABASE_URL);

  try {
    const profiles = await sql<Array<{ id: string; username: string }>>`
      select id, username from profiles where username_normalized = ${username.toLowerCase()}
    `;
    if (!profiles[0]) throw new Error(`No account exists for username ${username}.`);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase.auth.admin.updateUserById(profiles[0].id, { password });
    if (error) throw error;
    console.info(JSON.stringify({ username: profiles[0].username, passwordReset: true }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
