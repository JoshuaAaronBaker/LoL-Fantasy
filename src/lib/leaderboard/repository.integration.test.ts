import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { recalculateRosterScores } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userId = "92000000-0000-0000-0000-000000000001";
const providerPrefix = "leaderboard-integration";
let stageId = "";
let rosterId = "";
let captainId = "";
let secondPlayerId = "";

suite("leaderboard score materialization", () => {
  beforeAll(async () => {
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!`delete from tournaments where provider_id = ${providerPrefix}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values (${userId}, 'authenticated', 'authenticated', 'score_test@users.lolfantasy.invalid',
        '{"username":"score_test"}', now(), now())
    `;
    const tournaments = await sql!<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name)
      values ('cito', ${providerPrefix}, 'Leaderboard Integration') returning id
    `;
    const stages = await sql!<Array<{ id: string }>>`
      insert into tournament_stages (tournament_id, slug, name, sequence, roster_lock_time, status)
      values (${tournaments[0].id}, ${providerPrefix}, 'Leaderboard Integration', 1, '2099-01-01', 'OPEN')
      returning id
    `;
    stageId = stages[0].id;
    const teams = await sql!<Array<{ id: string }>>`
      insert into pro_teams (provider, provider_id, name)
      values ('cito', ${`${providerPrefix}-team`}, 'Score Team') returning id
    `;
    const players = await sql!<Array<{ id: string; provider_id: string }>>`
      insert into pro_players (provider, provider_id, display_name, current_team_id, role)
      values
        ('cito', ${`${providerPrefix}-captain`}, 'Captain', ${teams[0].id}, 'MID'),
        ('cito', ${`${providerPrefix}-support`}, 'Support', ${teams[0].id}, 'SUPPORT')
      returning id, provider_id
    `;
    captainId = players.find((player) => player.provider_id.endsWith("captain"))!.id;
    secondPlayerId = players.find((player) => player.provider_id.endsWith("support"))!.id;
    const rosters = await sql!<Array<{ id: string }>>`
      insert into fantasy_rosters (user_id, stage_id, captain_player_id, total_salary)
      values (${userId}, ${stageId}, ${captainId}, 20000000) returning id
    `;
    rosterId = rosters[0].id;
    await sql!`
      insert into fantasy_roster_players (roster_id, player_id, team_id, role, acquisition_price)
      values
        (${rosterId}, ${captainId}, ${teams[0].id}, 'MID', 10000000),
        (${rosterId}, ${secondPlayerId}, ${teams[0].id}, 'SUPPORT', 10000000)
    `;
    const matches = await sql!<Array<{ id: string }>>`
      insert into matches (provider, provider_id, tournament_id, stage_id, status)
      values ('cito', ${`${providerPrefix}-match`}, ${tournaments[0].id}, ${stageId}, 'COMPLETED') returning id
    `;
    const games = await sql!<Array<{ id: string }>>`
      insert into games (provider, provider_id, match_id, status, source_kind)
      values ('cito', ${`${providerPrefix}-game`}, ${matches[0].id}, 'COMPLETED', 'fixture') returning id
    `;
    const stats = await sql!<Array<{ id: string; player_id: string }>>`
      insert into player_game_stats (game_id, player_id, team_id, role, kills, deaths, assists, cs, won)
      values
        (${games[0].id}, ${captainId}, ${teams[0].id}, 'MID', 0, 0, 0, 0, false),
        (${games[0].id}, ${secondPlayerId}, ${teams[0].id}, 'SUPPORT', 0, 0, 0, 0, false)
      returning id, player_id
    `;
    const rules = await sql!<Array<{ id: string }>>`select id from fantasy_scoring_rule_sets where is_active`;
    for (const stat of stats) {
      const value = stat.player_id === captainId ? 10 : 5;
      await sql!`
        insert into player_game_scores (player_game_stat_id, rule_set_id, base_score, breakdown)
        values (${stat.id}, ${rules[0].id}, ${value}, '{}'::jsonb)
      `;
    }
  });

  afterAll(async () => {
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!`delete from tournaments where provider_id = ${providerPrefix}`;
    await sql!`delete from pro_players where provider_id like ${`${providerPrefix}%`}`;
    await sql!`delete from pro_teams where provider_id like ${`${providerPrefix}%`}`;
    await sql!.end();
  });

  it("applies the captain multiplier and converges on replay", async () => {
    await expect(recalculateRosterScores(sql!, stageId)).resolves.toEqual({ stages: 1, rosters: 1, players: 2 });
    await expect(recalculateRosterScores(sql!, stageId)).resolves.toEqual({ stages: 1, rosters: 1, players: 2 });
    const totals = await sql!<Array<{
      base_score: string; captain_bonus: string; total_score: string; games_scored: number;
    }>>`
      select base_score::text, captain_bonus::text, total_score::text, games_scored
      from fantasy_roster_stage_scores where roster_id = ${rosterId}
    `;
    expect(totals[0]).toEqual({ base_score: "15.00", captain_bonus: "5.00", total_score: "20.00", games_scored: 1 });
    const players = await sql!<Array<{ player_id: string; multiplier: string; final_score: string }>>`
      select player_id, multiplier::text, final_score::text
      from fantasy_roster_player_scores where roster_id = ${rosterId} order by final_score desc
    `;
    expect(players.sort((left, right) => Number(right.final_score) - Number(left.final_score))).toEqual([
      { player_id: captainId, multiplier: "1.5000", final_score: "15.00" },
      { player_id: secondPlayerId, multiplier: "1.0000", final_score: "5.00" },
    ]);
  });
});
