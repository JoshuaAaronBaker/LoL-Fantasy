alter table public.pro_teams add column image_url text;
alter table public.pro_players add column image_url text;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  username_normalized text not null check (username_normalized = lower(username)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_normalized_key unique (username_normalized)
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := new.raw_user_meta_data ->> 'username';
  if requested_username is null or requested_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'A valid username is required.';
  end if;

  insert into public.profiles (id, username, username_normalized)
  values (new.id, requested_username, lower(requested_username));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table public.tournament_teams (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.pro_teams(id) on delete cascade,
  source_updated_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, team_id)
);

create table public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  player_id uuid not null references public.pro_players(id) on delete cascade,
  team_id uuid not null references public.pro_teams(id) on delete restrict,
  role text not null check (role in ('TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT')),
  is_starter boolean not null,
  eligible boolean not null,
  roster_status text,
  roster_checked_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_players_stage_player_key unique (stage_id, player_id)
);

create table public.player_stage_prices (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  player_id uuid not null references public.pro_players(id) on delete cascade,
  projected_ppg numeric(12,4) not null,
  price numeric(12,2) not null check (price > 0),
  role_percentile numeric(7,6) not null check (role_percentile between 0 and 1),
  pricing_method text not null,
  pricing_version integer not null check (pricing_version > 0),
  eligible boolean not null default true,
  source_stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint player_stage_prices_stage_player_key unique (stage_id, player_id)
);

create table public.fantasy_rosters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  captain_player_id uuid not null references public.pro_players(id) on delete restrict,
  total_salary numeric(12,2) not null check (total_salary > 0),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fantasy_rosters_user_stage_key unique (user_id, stage_id)
);

create table public.fantasy_roster_players (
  roster_id uuid not null references public.fantasy_rosters(id) on delete cascade,
  player_id uuid not null references public.pro_players(id) on delete restrict,
  team_id uuid not null references public.pro_teams(id) on delete restrict,
  role text not null check (role in ('TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT')),
  acquisition_price numeric(12,2) not null check (acquisition_price > 0),
  created_at timestamptz not null default now(),
  primary key (roster_id, player_id),
  constraint fantasy_roster_players_roster_role_key unique (roster_id, role)
);

create or replace function public.prevent_open_stage_catalog_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_stage_id uuid;
  target_status text;
begin
  target_stage_id := case when tg_op = 'DELETE' then old.stage_id else new.stage_id end;
  select status into target_status from public.tournament_stages where id = target_stage_id;
  if target_status <> 'UPCOMING' then
    raise exception 'Stage catalog and prices are immutable after the stage opens.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tournament_players_immutable_after_open
before insert or update or delete on public.tournament_players
for each row execute function public.prevent_open_stage_catalog_changes();
create trigger player_stage_prices_immutable_after_open
before insert or update or delete on public.player_stage_prices
for each row execute function public.prevent_open_stage_catalog_changes();

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger tournament_teams_set_updated_at before update on public.tournament_teams
for each row execute function public.set_updated_at();
create trigger tournament_players_set_updated_at before update on public.tournament_players
for each row execute function public.set_updated_at();
create trigger fantasy_rosters_set_updated_at before update on public.fantasy_rosters
for each row execute function public.set_updated_at();

create index tournament_teams_team_id_idx on public.tournament_teams(team_id);
create index tournament_players_stage_id_idx on public.tournament_players(stage_id);
create index tournament_players_player_id_idx on public.tournament_players(player_id);
create index player_stage_prices_stage_id_idx on public.player_stage_prices(stage_id);
create index fantasy_rosters_user_id_idx on public.fantasy_rosters(user_id);
create index fantasy_roster_players_player_id_idx on public.fantasy_roster_players(player_id);

alter table public.profiles enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_players enable row level security;
alter table public.player_stage_prices enable row level security;
alter table public.fantasy_rosters enable row level security;
alter table public.fantasy_roster_players enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy tournament_stages_authenticated_read on public.tournament_stages
for select to authenticated using (true);
create policy pro_teams_authenticated_read on public.pro_teams
for select to authenticated using (true);
create policy pro_players_authenticated_read on public.pro_players
for select to authenticated using (true);
create policy tournament_teams_authenticated_read on public.tournament_teams
for select to authenticated using (true);
create policy tournament_players_authenticated_read on public.tournament_players
for select to authenticated using (true);
create policy player_stage_prices_authenticated_read on public.player_stage_prices
for select to authenticated using (true);

create policy fantasy_rosters_owner_all on public.fantasy_rosters
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy fantasy_roster_players_owner_all on public.fantasy_roster_players
for all to authenticated
using (exists (
  select 1 from public.fantasy_rosters r
  where r.id = roster_id and r.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.fantasy_rosters r
  where r.id = roster_id and r.user_id = (select auth.uid())
));

grant select, update on public.profiles to authenticated;
grant select on public.tournament_stages, public.pro_teams, public.pro_players,
  public.tournament_teams, public.tournament_players, public.player_stage_prices to authenticated;
grant select, insert, update, delete on public.fantasy_rosters, public.fantasy_roster_players to authenticated;

