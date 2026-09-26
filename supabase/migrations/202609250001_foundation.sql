create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  name text not null,
  start_time timestamptz,
  end_time timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournaments_provider_id_key unique (provider, provider_id)
);

create table public.tournament_stages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  slug text not null,
  name text not null,
  sequence integer not null check (sequence > 0),
  start_time timestamptz,
  roster_lock_time timestamptz,
  end_time timestamptz,
  status text not null default 'UPCOMING' check (status in ('UPCOMING', 'OPEN', 'LOCKED', 'LIVE', 'COMPLETE')),
  salary_cap numeric(12,2) not null default 50000000 check (salary_cap > 0),
  max_players_per_team integer not null default 2 check (max_players_per_team > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_stages_tournament_slug_key unique (tournament_id, slug),
  constraint tournament_stages_tournament_sequence_key unique (tournament_id, sequence),
  constraint tournament_stages_time_order check (
    (start_time is null or roster_lock_time is null or start_time <= roster_lock_time)
    and (roster_lock_time is null or end_time is null or roster_lock_time <= end_time)
  )
);

create table public.pro_teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  name text not null,
  abbreviation text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_teams_provider_id_key unique (provider, provider_id)
);

create table public.pro_players (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  display_name text not null,
  current_team_id uuid references public.pro_teams(id) on delete set null,
  role text check (role is null or role in ('TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_players_provider_id_key unique (provider, provider_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_id uuid references public.tournament_stages(id) on delete set null,
  provider_stage_label text,
  start_time timestamptz,
  status text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_provider_id_key unique (provider, provider_id)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  match_id uuid not null references public.matches(id) on delete cascade,
  game_number integer check (game_number is null or game_number > 0),
  status text not null,
  winner_team_id uuid references public.pro_teams(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  source_kind text not null check (source_kind in ('fixture', 'live')),
  raw_payload jsonb not null default '{}'::jsonb,
  stats_payload_hash text,
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_provider_id_key unique (provider, provider_id)
);

create table public.player_game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.pro_players(id) on delete restrict,
  team_id uuid not null references public.pro_teams(id) on delete restrict,
  role text check (role is null or role in ('TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT')),
  provider_role text,
  kills integer not null check (kills >= 0),
  deaths integer not null check (deaths >= 0),
  assists integer not null check (assists >= 0),
  cs numeric(10,2) not null check (cs >= 0),
  won boolean not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_game_stats_game_player_key unique (game_id, player_id)
);

create table public.fantasy_scoring_rule_sets (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null check (version > 0),
  name text not null,
  captain_multiplier numeric(8,4) not null default 1.5 check (captain_multiplier > 0),
  is_active boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fantasy_scoring_rule_sets_key_version_key unique (key, version)
);

create unique index fantasy_scoring_rule_sets_one_active
  on public.fantasy_scoring_rule_sets (is_active)
  where is_active;

create table public.fantasy_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.fantasy_scoring_rule_sets(id) on delete cascade,
  metric text not null check (metric in ('kills', 'deaths', 'assists', 'cs', 'win')),
  points_per_unit numeric(10,4) not null,
  role text check (role is null or role in ('TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT')),
  created_at timestamptz not null default now()
);

create unique index fantasy_scoring_rules_metric_role_key
  on public.fantasy_scoring_rules (rule_set_id, metric, coalesce(role, '*'));

create table public.player_game_scores (
  id uuid primary key default gen_random_uuid(),
  player_game_stat_id uuid not null references public.player_game_stats(id) on delete cascade,
  rule_set_id uuid not null references public.fantasy_scoring_rule_sets(id) on delete restrict,
  base_score numeric(12,2) not null,
  breakdown jsonb not null,
  calculated_at timestamptz not null default now(),
  constraint player_game_scores_stat_rule_set_key unique (player_game_stat_id, rule_set_id)
);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  resource_type text not null,
  resource_id text not null,
  source_kind text not null check (source_kind in ('fixture', 'live')),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'UNCHANGED', 'FAILED')),
  games_processed integer not null default 0 check (games_processed >= 0),
  stats_processed integer not null default 0 check (stats_processed >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index matches_tournament_id_idx on public.matches(tournament_id);
create index matches_stage_id_idx on public.matches(stage_id);
create index games_match_id_idx on public.games(match_id);
create index player_game_stats_game_id_idx on public.player_game_stats(game_id);
create index player_game_stats_player_id_idx on public.player_game_stats(player_id);
create index player_game_scores_rule_set_id_idx on public.player_game_scores(rule_set_id);
create index ingestion_runs_started_at_idx on public.ingestion_runs(started_at desc);

create trigger tournaments_set_updated_at before update on public.tournaments
for each row execute function public.set_updated_at();
create trigger tournament_stages_set_updated_at before update on public.tournament_stages
for each row execute function public.set_updated_at();
create trigger pro_teams_set_updated_at before update on public.pro_teams
for each row execute function public.set_updated_at();
create trigger pro_players_set_updated_at before update on public.pro_players
for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
for each row execute function public.set_updated_at();
create trigger games_set_updated_at before update on public.games
for each row execute function public.set_updated_at();
create trigger player_game_stats_set_updated_at before update on public.player_game_stats
for each row execute function public.set_updated_at();

alter table public.tournaments enable row level security;
alter table public.tournament_stages enable row level security;
alter table public.pro_teams enable row level security;
alter table public.pro_players enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.fantasy_scoring_rule_sets enable row level security;
alter table public.fantasy_scoring_rules enable row level security;
alter table public.player_game_scores enable row level security;
alter table public.ingestion_runs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

insert into public.fantasy_scoring_rule_sets (
  id, key, version, name, captain_multiplier, is_active, published_at
) values (
  '10000000-0000-0000-0000-000000000001', 'default-v1', 1,
  'Default completed-game scoring', 1.5, true, now()
);

insert into public.fantasy_scoring_rules (rule_set_id, metric, points_per_unit, role)
values
  ('10000000-0000-0000-0000-000000000001', 'kills', 3, null),
  ('10000000-0000-0000-0000-000000000001', 'deaths', -1, null),
  ('10000000-0000-0000-0000-000000000001', 'assists', 1.5, null),
  ('10000000-0000-0000-0000-000000000001', 'cs', 0.01, null),
  ('10000000-0000-0000-0000-000000000001', 'win', 2, null);
