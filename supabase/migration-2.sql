-- Etappe 1+2: Rechte, Gruppen, Gemeinschaftskonto (im SQL Editor ausführen)
alter table public.allowed_users add column if not exists can_mail boolean not null default false;
alter table public.allowed_users add column if not exists is_admin boolean not null default false;
alter table public.projects add column if not exists is_public boolean not null default true;

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check (email = lower(email)),
  primary key (project_id, email)
);
alter table public.project_members enable row level security;

-- Zugang zum Gemeinschaftskonto: nur der Server (Edge Function) darf lesen, keine Policy.
create table if not exists public.google_connection (
  id int primary key check (id = 1),
  email text not null,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.google_connection enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where email = lower(auth.jwt() ->> 'email') and is_admin);
$$;
create or replace function public.can_see_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_allowed() and (
    exists (select 1 from public.projects p where p.id = pid and p.is_public)
    or exists (select 1 from public.project_members m where m.project_id = pid and m.email = lower(auth.jwt() ->> 'email'))
    or public.is_admin());
$$;

drop policy if exists "projects lesen" on public.projects;
drop policy if exists "projects anlegen" on public.projects;
drop policy if exists "gruppen lesen" on public.projects;
drop policy if exists "gruppen verwalten" on public.projects;
drop policy if exists "notes lesen" on public.notes;
drop policy if exists "notes schreiben" on public.notes;
drop policy if exists "eigene notes löschen" on public.notes;
drop policy if exists "mitglieder lesen" on public.project_members;
drop policy if exists "mitglieder verwalten" on public.project_members;
drop policy if exists "eigene rechte lesen" on public.allowed_users;

create policy "gruppen lesen" on public.projects for select to authenticated using (public.can_see_project(id));
create policy "gruppen verwalten" on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "notes lesen" on public.notes for select to authenticated using (public.can_see_project(project_id));
create policy "notes schreiben" on public.notes for insert to authenticated
  with check (public.can_see_project(project_id) and author_email = lower(auth.jwt() ->> 'email'));
create policy "eigene notes löschen" on public.notes for delete to authenticated
  using (public.can_see_project(project_id) and author_email = lower(auth.jwt() ->> 'email'));
create policy "mitglieder lesen" on public.project_members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin());
create policy "mitglieder verwalten" on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Jede Person darf nur ihre eigene Zeile (Rechte) lesen, damit die App weiß, was sie anzeigen soll.
create policy "eigene rechte lesen" on public.allowed_users for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

update public.allowed_users set is_admin = true, can_mail = true where email = 'luizricardo.peters@gmail.com';
update public.allowed_users set can_mail = true
  where email in ('tina.hof@tierschutzverein-duesseldorf.de', 'k.peters@tierschutzverein-duesseldorf.de');
