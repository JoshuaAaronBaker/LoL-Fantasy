alter table public.player_game_stats
  add column vision_score numeric(10,2) check (vision_score is null or vision_score >= 0);

update public.player_game_stats
set vision_score = case
  when jsonb_typeof(raw_payload) = 'object'
    then nullif(raw_payload ->> 'visionScore', '')::numeric
  when jsonb_typeof(raw_payload) = 'string'
    then nullif(((raw_payload #>> '{}')::jsonb) ->> 'visionScore', '')::numeric
  else null
end
where raw_payload::text ~* 'visionScore';

alter table public.fantasy_scoring_rules
  drop constraint fantasy_scoring_rules_metric_check;

alter table public.fantasy_scoring_rules
  add constraint fantasy_scoring_rules_metric_check
  check (metric in ('kills', 'deaths', 'assists', 'cs', 'vision', 'win'));

update public.fantasy_scoring_rule_sets set is_active = false where is_active;

insert into public.fantasy_scoring_rule_sets (
  id, key, version, name, captain_multiplier, is_active, published_at
) values (
  '10000000-0000-0000-0000-000000000003', 'default-v3', 3,
  'Role-balanced scoring with support vision', 1.5, true, now()
);

insert into public.fantasy_scoring_rules (rule_set_id, metric, points_per_unit, role)
values
  ('10000000-0000-0000-0000-000000000003', 'kills', 3, null),
  ('10000000-0000-0000-0000-000000000003', 'deaths', -1, null),
  ('10000000-0000-0000-0000-000000000003', 'assists', 1.5, null),
  ('10000000-0000-0000-0000-000000000003', 'cs', 0.01, null),
  ('10000000-0000-0000-0000-000000000003', 'deaths', -0.75, 'SUPPORT'),
  ('10000000-0000-0000-0000-000000000003', 'assists', 1.75, 'SUPPORT'),
  ('10000000-0000-0000-0000-000000000003', 'vision', 0.025, 'SUPPORT');

insert into public.player_game_scores (
  player_game_stat_id, rule_set_id, base_score, breakdown, calculated_at
)
select stat.id, '10000000-0000-0000-0000-000000000003',
  round(
    stat.kills * 3
    + stat.deaths * case when stat.role = 'SUPPORT' then -0.75 else -1 end
    + stat.assists * case when stat.role = 'SUPPORT' then 1.75 else 1.5 end
    + stat.cs * 0.01
    + case when stat.role = 'SUPPORT' then coalesce(stat.vision_score, 0) * 0.025 else 0 end,
    2
  ),
  jsonb_build_object(
    'kills', round(stat.kills * 3, 2)::text,
    'deaths', round(stat.deaths * case when stat.role = 'SUPPORT' then -0.75 else -1 end, 2)::text,
    'assists', round(stat.assists * case when stat.role = 'SUPPORT' then 1.75 else 1.5 end, 2)::text,
    'cs', round(stat.cs * 0.01, 2)::text,
    'vision', round(case when stat.role = 'SUPPORT' then coalesce(stat.vision_score, 0) * 0.025 else 0 end, 2)::text,
    'win', '0.00'
  ),
  now()
from public.player_game_stats stat
on conflict (player_game_stat_id, rule_set_id) do update set
  base_score = excluded.base_score,
  breakdown = excluded.breakdown,
  calculated_at = excluded.calculated_at;

delete from public.fantasy_roster_player_scores;

insert into public.fantasy_roster_player_scores (
  roster_id, player_id, rule_set_id, base_score, multiplier, final_score, games_scored, calculated_at
)
select rp.roster_id, rp.player_id, '10000000-0000-0000-0000-000000000003',
  round(coalesce(sum(case when match.id is not null then score.base_score else 0 end), 0), 2),
  case when roster.captain_player_id = rp.player_id then 1.5 else 1 end,
  round(
    coalesce(sum(case when match.id is not null then score.base_score else 0 end), 0)
    * case when roster.captain_player_id = rp.player_id then 1.5 else 1 end,
    2
  ),
  count(distinct case when match.id is not null and score.id is not null then game.id end)::int,
  now()
from public.fantasy_rosters roster
join public.fantasy_roster_players rp on rp.roster_id = roster.id
left join public.player_game_stats stat on stat.player_id = rp.player_id
left join public.games game on game.id = stat.game_id
left join public.matches match on match.id = game.match_id and match.stage_id = roster.stage_id
left join public.player_game_scores score
  on score.player_game_stat_id = stat.id
  and score.rule_set_id = '10000000-0000-0000-0000-000000000003'
  and match.id is not null
group by rp.roster_id, rp.player_id, roster.captain_player_id;

insert into public.fantasy_roster_stage_scores (
  roster_id, stage_id, rule_set_id, base_score, captain_bonus, total_score, games_scored, calculated_at
)
select roster.id, roster.stage_id, '10000000-0000-0000-0000-000000000003',
  round(coalesce(sum(player_score.base_score), 0), 2),
  round(coalesce(sum(player_score.final_score - player_score.base_score), 0), 2),
  round(coalesce(sum(player_score.final_score), 0), 2),
  coalesce((
    select count(distinct game.id)::int
    from public.fantasy_roster_players rp2
    join public.player_game_stats stat2 on stat2.player_id = rp2.player_id
    join public.games game on game.id = stat2.game_id
    join public.matches match on match.id = game.match_id and match.stage_id = roster.stage_id
    join public.player_game_scores score2
      on score2.player_game_stat_id = stat2.id
      and score2.rule_set_id = '10000000-0000-0000-0000-000000000003'
    where rp2.roster_id = roster.id
  ), 0),
  now()
from public.fantasy_rosters roster
left join public.fantasy_roster_player_scores player_score on player_score.roster_id = roster.id
group by roster.id
on conflict (roster_id) do update set
  stage_id = excluded.stage_id,
  rule_set_id = excluded.rule_set_id,
  base_score = excluded.base_score,
  captain_bonus = excluded.captain_bonus,
  total_score = excluded.total_score,
  games_scored = excluded.games_scored,
  calculated_at = excluded.calculated_at;
