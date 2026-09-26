create policy tournaments_authenticated_read on public.tournaments
for select to authenticated using (true);

grant select on public.tournaments to authenticated;

