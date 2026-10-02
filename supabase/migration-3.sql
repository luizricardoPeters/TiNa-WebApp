-- Ehrenamtlichen-Liste: alle freigeschalteten Personen lesen, nur Admins pflegen.
create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  task text check (char_length(task) <= 500),
  contact text check (char_length(contact) <= 300),
  created_at timestamptz not null default now()
);
alter table public.volunteers enable row level security;
drop policy if exists "team lesen" on public.volunteers;
drop policy if exists "team verwalten" on public.volunteers;
create policy "team lesen" on public.volunteers for select to authenticated using (public.is_allowed());
create policy "team verwalten" on public.volunteers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
