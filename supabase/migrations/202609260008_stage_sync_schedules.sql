alter table public.operator_jobs drop constraint operator_jobs_job_type_check;
alter table public.operator_jobs add constraint operator_jobs_job_type_check
  check (job_type in ('STAGE_BOOTSTRAP', 'STAGE_SYNC'));

create table public.stage_sync_schedules (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null unique references public.tournament_stages(id) on delete cascade,
  enabled boolean not null default true,
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  match_provider_ids text[] not null check (cardinality(match_provider_ids) > 0),
  refresh_completed boolean not null default false,
  next_run_at timestamptz not null default now(),
  last_enqueued_at timestamptz,
  created_by uuid not null references public.fantasy_operators(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stage_sync_schedules_due_idx
  on public.stage_sync_schedules(next_run_at)
  where enabled;

create trigger stage_sync_schedules_set_updated_at before update on public.stage_sync_schedules
for each row execute function public.set_updated_at();

alter table public.stage_sync_schedules enable row level security;
revoke all on public.stage_sync_schedules from anon, authenticated;

comment on table public.stage_sync_schedules is
  'Server-managed recurring stage sync manifests. A scheduler converts due rows into durable operator jobs.';
