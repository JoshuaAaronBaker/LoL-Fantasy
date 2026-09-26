import "dotenv/config";
import { parseFlags } from "../src/lib/cli/arguments";
import { configureCompetition } from "../src/lib/competitions/repository";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required to configure a competition.");
  const tournamentId = flags.required("tournament");
  const provider = new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY });
  const tournament = await provider.getTournament(tournamentId);
  const sql = createDatabase(env.DATABASE_URL);
  try {
    const result = await configureCompetition(sql, {
      slug: flags.required("competition"),
      name: flags.required("name"),
      description: flags.optional("description") ?? "",
      tournament,
    });
    console.info(JSON.stringify({ ...result, providerTournamentId: tournament.providerId }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
