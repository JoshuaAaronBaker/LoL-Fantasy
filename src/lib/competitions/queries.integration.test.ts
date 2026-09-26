import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { getCompetitionHubWithDatabase } from "./queries";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const prefix = "worlds-hub-integration";
const userOne = "93000000-0000-0000-0000-000000000001";
const userTwo = "93000000-0000-0000-0000-000000000002";

suite("competition hub", () => {
  beforeAll(async () => {
    await sql!`delete from auth.users where id in (${userOne}, ${userTwo})`;
    await sql!`delete from fantasy_competitions where slug = ${prefix}`;
    await sql!`delete from tournaments where provider_id = ${prefix}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values
        (${userOne}, 'authenticated', 'authenticated', 'worlds_one@users.lolfantasy.invalid', '{"username":"worlds_one"}', now(), now()),
        (${userTwo}, 'authenticated', 'authenticated', 'worlds_two@users.lolfantasy.invalid', '{"username":"worlds_two"}', now(), now())
    `;
    const tournaments = await sql!<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name)
      values ('cito', ${prefix}, 'Worlds Hub Integration') returning id
    `;
    await sql!`
      insert into fantasy_competitions (slug, name, tournament_id, status)
      values (${prefix}, 'Worlds Hub Integration', ${tournaments[0].id}, 'ACTIVE')
    `;
    const stages = await sql!<Array<{ id: string; sequence: number }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values
        (${tournaments[0].id}, ${`${prefix}-one`}, 'Round One', 1, '2020-01-01', 'COMPLETE'),
        (${tournaments[0].id}, ${`${prefix}-two`}, 'Round Two', 2, '2020-01-02', 'COMPLETE')
      returning id, sequence
    `;
    const teams = await sql!<Array<{ id: string }>>`
      insert into pro_teams (provider, provider_id, name)
      values ('cito', ${`${prefix}-team`}, 'Worlds Team') returning id
    `;
    const players = await sql!<Array<{ id: string }>>`
      insert into pro_players (provider, provider_id, display_name, current_team_id, role)
      values ('cito', ${`${prefix}-player`}, 'Worlds Player', ${teams[0].id}, 'MID') returning id
    `;
    const stageOne = stages.find((stage) => stage.sequence === 1)!.id;
    const stageTwo = stages.find((stage) => stage.sequence === 2)!.id;
    const rosters = await sql!<Array<{ id: string; user_id: string; stage_id: string }>>`
      insert into fantasy_rosters (user_id, stage_id, captain_player_id, total_salary)
      values
        (${userOne}, ${stageOne}, ${players[0].id}, 10000000),
        (${userOne}, ${stageTwo}, ${players[0].id}, 10000000),
        (${userTwo}, ${stageOne}, ${players[0].id}, 10000000)
      returning id, user_id, stage_id
    `;
    const ruleSets = await sql!<Array<{ id: string }>>`select id from fantasy_scoring_rule_sets where is_active`;
    for (const roster of rosters) {
      const score = roster.user_id === userOne ? (roster.stage_id === stageOne ? 10 : 15) : 20;
      await sql!`
        insert into fantasy_roster_stage_scores
          (roster_id, stage_id, rule_set_id, base_score, captain_bonus, total_score, games_scored)
        values (${roster.id}, ${roster.stage_id}, ${ruleSets[0].id}, ${score}, 0, ${score}, 1)
      `;
    }
  });

  afterAll(async () => {
    await sql!`delete from auth.users where id in (${userOne}, ${userTwo})`;
    await sql!`delete from fantasy_competitions where slug = ${prefix}`;
    await sql!`delete from tournaments where provider_id = ${prefix}`;
    await sql!`delete from pro_players where provider_id like ${`${prefix}%`}`;
    await sql!`delete from pro_teams where provider_id like ${`${prefix}%`}`;
    await sql!.end();
  });

  it("sums stage scores into one ranked tournament leaderboard", async () => {
    const hub = await getCompetitionHubWithDatabase(sql!, prefix, userOne);
    expect(hub).toMatchObject({
      name: "Worlds Hub Integration",
      currentStage: { name: "Round Two", hasCurrentUserRoster: true },
    });
    expect(hub?.standings).toEqual([
      expect.objectContaining({ rank: 1, username: "worlds_one", totalScore: 25, stagesEntered: 2, isCurrentUser: true }),
      expect.objectContaining({ rank: 2, username: "worlds_two", totalScore: 20, stagesEntered: 1, isCurrentUser: false }),
    ]);
  });
});
