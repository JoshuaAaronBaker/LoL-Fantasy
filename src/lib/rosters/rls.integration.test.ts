import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userA = "91000000-0000-0000-0000-000000000001";
const userB = "91000000-0000-0000-0000-000000000002";
const tournamentProviderId = "rls-integration-tournament";

suite("roster RLS", () => {
  beforeAll(async () => {
    await sql!`delete from auth.users where id in (${userA}, ${userB})`;
    await sql!`delete from tournaments where provider_id = ${tournamentProviderId}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values
        (${userA}, 'authenticated', 'authenticated', 'rls_a@users.lolfantasy.invalid', '{"username":"rls_a"}', now(), now()),
        (${userB}, 'authenticated', 'authenticated', 'rls_b@users.lolfantasy.invalid', '{"username":"rls_b"}', now(), now())
    `;
    const tournaments = await sql!<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name) values ('cito', ${tournamentProviderId}, 'RLS Tournament')
      returning id
    `;
    const stages = await sql!<Array<{ id: string }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, 'rls-stage', 'RLS Stage', 1, '2099-01-01', 'UPCOMING') returning id
    `;
    const teams = await sql!<Array<{ id: string }>>`
      insert into pro_teams (provider, provider_id, name) values ('cito', 'rls-team', 'RLS Team') returning id
    `;
    const players = await sql!<Array<{ id: string }>>`
      insert into pro_players (provider, provider_id, display_name, current_team_id, role)
      values ('cito', 'rls-player', 'RLS Player', ${teams[0].id}, 'TOP') returning id
    `;
    await sql!`
      insert into tournament_players (tournament_id, stage_id, player_id, team_id, role, is_starter, eligible)
      values (${tournaments[0].id}, ${stages[0].id}, ${players[0].id}, ${teams[0].id}, 'TOP', true, true)
    `;
    await sql!`
      insert into player_stage_prices (stage_id, player_id, projected_ppg, price, role_percentile, pricing_method, pricing_version)
      values (${stages[0].id}, ${players[0].id}, 10, 10000000, 0.5, 'test', 1)
    `;
    await sql!`update tournament_stages set status = 'OPEN' where id = ${stages[0].id}`;
    for (const userId of [userA, userB]) {
      const rosters = await sql!<Array<{ id: string }>>`
        insert into fantasy_rosters (user_id, stage_id, captain_player_id, total_salary)
        values (${userId}, ${stages[0].id}, ${players[0].id}, 10000000) returning id
      `;
      await sql!`
        insert into fantasy_roster_players (roster_id, player_id, team_id, role, acquisition_price)
        values (${rosters[0].id}, ${players[0].id}, ${teams[0].id}, 'TOP', 10000000)
      `;
    }
  });

  afterAll(async () => {
    await sql!`update tournament_stages set status = 'UPCOMING' where slug = 'rls-stage'`;
    await sql!`delete from auth.users where id in (${userA}, ${userB})`;
    await sql!`delete from tournaments where provider_id = ${tournamentProviderId}`;
    await sql!`delete from pro_players where provider_id = 'rls-player'`;
    await sql!`delete from pro_teams where provider_id = 'rls-team'`;
    await sql!.end();
  });

  it("shows catalog rows and only the caller's profile and roster", async () => {
    await sql!.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userA}, true)`;
      await tx`set local role authenticated`;
      const profiles = await tx<Array<{ id: string }>>`select id from profiles where id in (${userA}, ${userB})`;
      const rosters = await tx<Array<{ user_id: string }>>`select user_id from fantasy_rosters`;
      const entries = await tx<Array<{ count: number }>>`select count(*)::int as count from fantasy_roster_players`;
      const tournaments = await tx<Array<{ count: number }>>`
        select count(*)::int as count from tournaments where provider_id = ${tournamentProviderId}
      `;
      expect(profiles).toEqual([{ id: userA }]);
      expect(rosters).toEqual([{ user_id: userA }]);
      expect(entries[0].count).toBe(1);
      expect(tournaments[0].count).toBe(1);
    });
  });
});

