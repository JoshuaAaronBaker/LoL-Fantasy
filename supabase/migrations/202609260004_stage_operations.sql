create table public.stage_sync_runs (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'UNCHANGED', 'FAILED')),
  previous_stage_status text not null check (previous_stage_status in ('UPCOMING', 'OPEN', 'LOCKED', 'LIVE', 'COMPLETE')),
  resulting_stage_status text check (resulting_stage_status is null or resulting_stage_status in ('UPCOMING', 'OPEN', 'LOCKED', 'LIVE', 'COMPLETE')),
  requested_match_ids text[] not null default '{}'::text[],
  matches_processed integer not null default 0 check (matches_processed >= 0),
  games_ingested integer not null default 0 check (games_ingested >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index stage_sync_runs_stage_started_at_idx
  on public.stage_sync_runs(stage_id, started_at desc);

alter table public.stage_sync_runs enable row level security;
revoke all on public.stage_sync_runs from anon, authenticated;
