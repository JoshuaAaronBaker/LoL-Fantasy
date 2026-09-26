create table public.fantasy_competitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  tournament_id uuid unique references public.tournaments(id) on delete set null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'COMPLETE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger fantasy_competitions_set_updated_at before update on public.fantasy_competitions
for each row execute function public.set_updated_at();

alter table public.fantasy_competitions enable row level security;
create policy fantasy_competitions_authenticated_read on public.fantasy_competitions
for select to authenticated using (true);
grant select on public.fantasy_competitions to authenticated;

insert into public.fantasy_competitions (id, slug, name, description, status)
values (
  '40000000-0000-0000-0000-000000000001',
  'worlds',
  'World Championship Fantasy',
  'Redraft through every World Championship roster window and climb one global leaderboard.',
  'DRAFT'
);
