create table public.operator_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('STAGE_BOOTSTRAP')),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  payload jsonb not null,
  idempotency_key text not null unique,
  requested_by uuid not null references public.fantasy_operators(user_id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  worker_id text,
  lease_expires_at timestamptz,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index operator_jobs_claim_idx
  on public.operator_jobs(status, created_at)
  where status in ('QUEUED', 'RUNNING');

create trigger operator_jobs_set_updated_at before update on public.operator_jobs
for each row execute function public.set_updated_at();

alter table public.operator_jobs enable row level security;
revoke all on public.operator_jobs from anon, authenticated;

comment on table public.operator_jobs is
  'Server-managed durable operator work. Payloads contain identifiers and configuration, never credentials.';
