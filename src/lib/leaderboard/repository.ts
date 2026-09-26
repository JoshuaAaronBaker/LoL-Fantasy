import type { Sql, TransactionSql } from "postgres";

type Db = Sql | TransactionSql<Record<string, never>>;

export interface RosterScoreRecalculationResult {
  stages: number;
  rosters: number;
  players: number;
}

export async function recalculateRosterScores(sql: Db, stageId?: string): Promise<RosterScoreRecalculationResult> {
  const ruleSets = await sql<Array<{ id: string; captain_multiplier: string }>>`
    select id, captain_multiplier::text
    from fantasy_scoring_rule_sets
    where is_active
    limit 1
  `;
  const ruleSet = ruleSets[0];
  if (!ruleSet) throw new Error("No active fantasy scoring rule set exists.");

  const stages = await sql<Array<{ id: string }>>`
    select id from tournament_stages
    where ${stageId ? sql`id = ${stageId}` : sql`true`}
      and exists (select 1 from fantasy_rosters r where r.stage_id = tournament_stages.id)
  `;
  let rostersProcessed = 0;
  let playersProcessed = 0;

  for (const stage of stages) {
    const rosters = await sql<Array<{ id: string }>>`
      select id from fantasy_rosters where stage_id = ${stage.id}
    `;
    if (rosters.length === 0) continue;
    const rosterIds = rosters.map((roster) => roster.id);

    await sql`delete from fantasy_roster_player_scores where roster_id in ${sql(rosterIds)}`;
    const playerScores = await sql<Array<{ roster_id: string }>>`
      insert into fantasy_roster_player_scores (
        roster_id, player_id, rule_set_id, base_score, multiplier, final_score, games_scored, calculated_at
      )
      select rp.roster_id, rp.player_id, ${ruleSet.id},
        round(coalesce(sum(case when m.id is not null then score.base_score else 0 end), 0), 2) as base_score,
        case when r.captain_player_id = rp.player_id then ${ruleSet.captain_multiplier}::numeric else 1 end as multiplier,
        round(
          coalesce(sum(case when m.id is not null then score.base_score else 0 end), 0)
          * case when r.captain_player_id = rp.player_id then ${ruleSet.captain_multiplier}::numeric else 1 end,
          2
        ) as final_score,
        count(distinct case when m.id is not null and score.id is not null then g.id end)::int as games_scored,
        clock_timestamp()
      from fantasy_rosters r
      join fantasy_roster_players rp on rp.roster_id = r.id
      left join player_game_stats stat on stat.player_id = rp.player_id
      left join games g on g.id = stat.game_id
      left join matches m on m.id = g.match_id and m.stage_id = r.stage_id
      left join player_game_scores score
        on score.player_game_stat_id = stat.id and score.rule_set_id = ${ruleSet.id} and m.id is not null
      where r.stage_id = ${stage.id}
      group by rp.roster_id, rp.player_id, r.captain_player_id
      returning roster_id
    `;

    const stageScores = await sql<Array<{ roster_id: string }>>`
      insert into fantasy_roster_stage_scores (
        roster_id, stage_id, rule_set_id, base_score, captain_bonus, total_score, games_scored, calculated_at
      )
      select r.id, r.stage_id, ${ruleSet.id},
        round(coalesce(sum(ps.base_score), 0), 2),
        round(coalesce(sum(ps.final_score - ps.base_score), 0), 2),
        round(coalesce(sum(ps.final_score), 0), 2),
        coalesce((
          select count(distinct g.id)::int
          from fantasy_roster_players rp2
          join player_game_stats stat2 on stat2.player_id = rp2.player_id
          join games g on g.id = stat2.game_id
          join matches m on m.id = g.match_id and m.stage_id = r.stage_id
          join player_game_scores score2
            on score2.player_game_stat_id = stat2.id and score2.rule_set_id = ${ruleSet.id}
          where rp2.roster_id = r.id
        ), 0),
        clock_timestamp()
      from fantasy_rosters r
      left join fantasy_roster_player_scores ps on ps.roster_id = r.id
      where r.stage_id = ${stage.id}
      group by r.id
      on conflict (roster_id) do update set
        stage_id = excluded.stage_id,
        rule_set_id = excluded.rule_set_id,
        base_score = excluded.base_score,
        captain_bonus = excluded.captain_bonus,
        total_score = excluded.total_score,
        games_scored = excluded.games_scored,
        calculated_at = excluded.calculated_at
      returning roster_id
    `;
    rostersProcessed += stageScores.length;
    playersProcessed += playerScores.length;
  }

  return { stages: stages.length, rosters: rostersProcessed, players: playersProcessed };
}

