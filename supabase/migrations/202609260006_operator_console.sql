create table public.fantasy_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null default 'operator-cli'
);

create table public.competition_tournament_candidates (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.fantasy_competitions(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  name text not null,
  league_name text,
  league_slug text,
  start_time timestamptz,
  end_time timestamptz,
  is_international boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  constraint competition_tournament_candidates_provider_key
    unique (competition_id, provider, provider_id)
);

alter table public.fantasy_competitions add column provider_checked_at timestamptz;

create index competition_tournament_candidates_competition_idx
  on public.competition_tournament_candidates(competition_id, start_time desc);

alter table public.fantasy_operators enable row level security;
alter table public.competition_tournament_candidates enable row level security;

revoke all on public.fantasy_operators from anon, authenticated;
revoke all on public.competition_tournament_candidates from anon, authenticated;

comment on table public.fantasy_operators is
  'Server-managed operator allowlist. No browser grants or self-service policies.';
comment on table public.competition_tournament_candidates is
  'Server-managed provider discoveries awaiting explicit operator selection.';
