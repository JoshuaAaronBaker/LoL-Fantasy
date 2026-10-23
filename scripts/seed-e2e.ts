import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";

const roles = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"] as const;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The E2E catalog must never be seeded in production.");
  const sql = createDatabase(getServerEnv().DATABASE_URL);
  try {
    const existing = await sql<Array<{ id: string }>>`
      select id from tournament_stages where slug = 'lcs-dev-playoffs' limit 1
    `;
    if (existing[0]) {
      console.info(JSON.stringify({ status: "UNCHANGED", stageSlug: "lcs-dev-playoffs" }, null, 2));
      return;
    }

    await sql.begin(async (tx) => {
      const tournaments = await tx<Array<{ id: string }>>`
        insert into tournaments (provider, provider_id, name)
        values ('fixture', 'e2e-lcs-dev', 'LCS Development')
        returning id
      `;
      const tournamentId = tournaments[0].id;
      const stages = await tx<Array<{ id: string }>>`
        insert into tournament_stages (
          tournament_id, slug, name, sequence, roster_lock_time, status, salary_cap, max_players_per_team
        ) values (
          ${tournamentId}, 'lcs-dev-playoffs', 'LCS Development Playoffs', 1,
          '2099-01-01T00:00:00Z', 'UPCOMING', 50000000, 2
        ) returning id
      `;
      const stageId = stages[0].id;
      const teamIds: string[] = [];
      for (const [index, name] of ["Fixture Alpha", "Fixture Bravo", "Fixture Charlie"].entries()) {
        const teams = await tx<Array<{ id: string }>>`
          insert into pro_teams (provider, provider_id, name, abbreviation)
          values ('fixture', ${`e2e-team-${index + 1}`}, ${name}, ${`T${index + 1}`})
          returning id
        `;
        teamIds.push(teams[0].id);
        await tx`
          insert into tournament_teams (tournament_id, team_id, source_updated_at)
          values (${tournamentId}, ${teams[0].id}, clock_timestamp())
        `;
      }

      for (const [index, role] of roles.entries()) {
        const teamId = teamIds[index < 2 ? 0 : index < 4 ? 1 : 2];
        const players = await tx<Array<{ id: string }>>`
          insert into pro_players (provider, provider_id, display_name, current_team_id, role)
          values ('fixture', ${`e2e-player-${role.toLowerCase()}`}, ${`Fixture ${role}`}, ${teamId}, ${role})
          returning id
        `;
        await tx`
          insert into tournament_players (
            tournament_id, stage_id, player_id, team_id, role, is_starter, eligible,
            roster_status, roster_checked_at
          ) values (
            ${tournamentId}, ${stageId}, ${players[0].id}, ${teamId}, ${role}, true, true,
            'ACTIVE', clock_timestamp()
          )
        `;
        await tx`
          insert into player_stage_prices (
            stage_id, player_id, projected_ppg, price, role_percentile, pricing_method,
            pricing_version, eligible, source_stats
          ) values (
            ${stageId}, ${players[0].id}, ${20 + index}, 10000000, 0.5,
            'e2e-fixed', 1, true, ${tx.json({ fixture: true })}
          )
        `;
      }
      await tx`update tournament_stages set status = 'OPEN' where id = ${stageId}`;
    });
    console.info(JSON.stringify({ status: "SEEDED", stageSlug: "lcs-dev-playoffs" }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
