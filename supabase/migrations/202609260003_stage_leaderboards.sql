create table public.fantasy_roster_stage_scores (
  roster_id uuid primary key references public.fantasy_rosters(id) on delete cascade,
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  rule_set_id uuid not null references public.fantasy_scoring_rule_sets(id) on delete restrict,
  base_score numeric(14,2) not null default 0,
  captain_bonus numeric(14,2) not null default 0,
  total_score numeric(14,2) not null default 0,
  games_scored integer not null default 0 check (games_scored >= 0),
  calculated_at timestamptz not null default now()
);

create table public.fantasy_roster_player_scores (
  roster_id uuid not null references public.fantasy_rosters(id) on delete cascade,
  player_id uuid not null references public.pro_players(id) on delete restrict,
  rule_set_id uuid not null references public.fantasy_scoring_rule_sets(id) on delete restrict,
  base_score numeric(14,2) not null default 0,
  multiplier numeric(8,4) not null default 1 check (multiplier > 0),
  final_score numeric(14,2) not null default 0,
  games_scored integer not null default 0 check (games_scored >= 0),
  calculated_at timestamptz not null default now(),
  primary key (roster_id, player_id)
);

create index fantasy_roster_stage_scores_stage_id_idx
  on public.fantasy_roster_stage_scores(stage_id, total_score desc);
create index fantasy_roster_player_scores_player_id_idx
  on public.fantasy_roster_player_scores(player_id);

alter table public.fantasy_roster_stage_scores enable row level security;
alter table public.fantasy_roster_player_scores enable row level security;

drop policy fantasy_rosters_owner_all on public.fantasy_rosters;
drop policy fantasy_roster_players_owner_all on public.fantasy_roster_players;

create policy fantasy_rosters_owner_read on public.fantasy_rosters
for select to authenticated using ((select auth.uid()) = user_id);
create policy fantasy_rosters_reveal_after_lock on public.fantasy_rosters
for select to authenticated using (exists (
  select 1 from public.tournament_stages s
  where s.id = stage_id
    and (s.status in ('LOCKED', 'LIVE', 'COMPLETE') or clock_timestamp() >= s.roster_lock_time)
));
create policy fantasy_rosters_owner_insert_before_lock on public.fantasy_rosters
for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.tournament_stages s
    where s.id = stage_id and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
  )
);
create policy fantasy_rosters_owner_update_before_lock on public.fantasy_rosters
for update to authenticated using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.tournament_stages s
    where s.id = stage_id and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
  )
) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.tournament_stages s
    where s.id = stage_id and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
  )
);
create policy fantasy_rosters_owner_delete_before_lock on public.fantasy_rosters
for delete to authenticated using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.tournament_stages s
    where s.id = stage_id and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
  )
);

create policy fantasy_roster_players_owner_read on public.fantasy_roster_players
for select to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  where r.id = roster_id and r.user_id = (select auth.uid())
));
create policy fantasy_roster_players_reveal_after_lock on public.fantasy_roster_players
for select to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id
    and (s.status in ('LOCKED', 'LIVE', 'COMPLETE') or clock_timestamp() >= s.roster_lock_time)
));
create policy fantasy_roster_players_owner_insert_before_lock on public.fantasy_roster_players
for insert to authenticated with check (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id and r.user_id = (select auth.uid())
    and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
));
create policy fantasy_roster_players_owner_update_before_lock on public.fantasy_roster_players
for update to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id and r.user_id = (select auth.uid())
    and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
)) with check (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id and r.user_id = (select auth.uid())
    and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
));
create policy fantasy_roster_players_owner_delete_before_lock on public.fantasy_roster_players
for delete to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id and r.user_id = (select auth.uid())
    and s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
));

create policy fantasy_roster_stage_scores_authenticated_read on public.fantasy_roster_stage_scores
for select to authenticated using (true);
create policy fantasy_roster_player_scores_owner_read on public.fantasy_roster_player_scores
for select to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  where r.id = roster_id and r.user_id = (select auth.uid())
));
create policy fantasy_roster_player_scores_reveal_after_lock on public.fantasy_roster_player_scores
for select to authenticated using (exists (
  select 1 from public.fantasy_rosters r
  join public.tournament_stages s on s.id = r.stage_id
  where r.id = roster_id
    and (s.status in ('LOCKED', 'LIVE', 'COMPLETE') or clock_timestamp() >= s.roster_lock_time)
));

grant select on public.fantasy_roster_stage_scores, public.fantasy_roster_player_scores to authenticated;

