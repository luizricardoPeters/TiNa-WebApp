-- TiNa-WebApp: Tabellen für gemeinsame Notizen. Im Supabase "SQL Editor" einmal ausführen.

create table if not exists public.allowed_users (
  email text primary key check (email = lower(email))
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 5000),
  author_name text,
  author_email text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists notes_project_idx on public.notes (project_id, created_at desc);

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where email = lower(auth.jwt() ->> 'email'));
$$;

alter table public.allowed_users enable row level security;  -- keine Policy: nur im Dashboard änderbar
alter table public.projects enable row level security;
alter table public.notes enable row level security;

create policy "projects lesen" on public.projects for select to authenticated using (public.is_allowed());
create policy "projects anlegen" on public.projects for insert to authenticated with check (public.is_allowed());
create policy "notes lesen" on public.notes for select to authenticated using (public.is_allowed());
create policy "notes schreiben" on public.notes for insert to authenticated
  with check (public.is_allowed() and author_email = lower(auth.jwt() ->> 'email'));
create policy "eigene notes löschen" on public.notes for delete to authenticated
  using (public.is_allowed() and author_email = lower(auth.jwt() ->> 'email'));

alter publication supabase_realtime add table public.notes;

insert into public.projects (name, sort) values ('Allgemein', 1), ('Tiere', 2), ('Organisation', 3)
on conflict (name) do nothing;

-- Erlaubte Personen eintragen (Adressen in Kleinbuchstaben), z. B.:
-- insert into public.allowed_users (email) values ('name@gmail.com'), ('mama@gmail.com');
