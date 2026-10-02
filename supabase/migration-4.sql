-- Rollen pro E-Mail-Adresse. Im SQL Editor ausführen.
-- admin = alles | postfach = Postfach + Kalender (eintragen) + Notizen
-- mitarbeit = Kalender (eintragen) + Notizen | ehrenamt = Kalender (nur ansehen) + Notizen
alter table public.allowed_users add column if not exists role text not null default 'mitarbeit';
alter table public.allowed_users drop constraint if exists allowed_users_role_check;
alter table public.allowed_users add constraint allowed_users_role_check check (role in ('admin','postfach','mitarbeit','ehrenamt'));
alter table public.allowed_users add column if not exists can_edit_cal boolean not null default false;

-- Die Rolle bestimmt die Einzelrechte automatisch.
create or replace function public.apply_role() returns trigger language plpgsql as $$
begin
  new.email := lower(new.email);
  new.is_admin := new.role = 'admin';
  new.can_mail := new.role in ('admin','postfach');
  new.can_edit_cal := new.role in ('admin','postfach','mitarbeit');
  return new;
end $$;
drop trigger if exists apply_role on public.allowed_users;
create trigger apply_role before insert or update on public.allowed_users for each row execute function public.apply_role();

-- Bestehende Personen übernehmen.
update public.allowed_users set role = case when is_admin then 'admin' when can_mail then 'postfach' else 'mitarbeit' end;

-- Gruppen: Mindest-Rolle (0 ehrenamt, 1 mitarbeit, 2 postfach, 3 admin)
alter table public.projects add column if not exists min_level int not null default 0;
create or replace function public.role_level() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select case role when 'admin' then 3 when 'postfach' then 2 when 'mitarbeit' then 1 else 0 end
    from public.allowed_users where email = lower(auth.jwt() ->> 'email')), 0);
$$;
create or replace function public.can_see_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_allowed() and (
    public.is_admin()
    or exists (select 1 from public.project_members m where m.project_id = pid and m.email = lower(auth.jwt() ->> 'email'))
    or exists (select 1 from public.projects p where p.id = pid and p.is_public and public.role_level() >= p.min_level));
$$;

-- Gruppe für Ehrenamtliche (sehen alle). "Organisation" ist nur für Mitarbeit und höher.
insert into public.projects (name, sort, is_public, min_level) values ('Ehrenamtliche', 4, true, 0) on conflict (name) do nothing;
update public.projects set min_level = 1 where name = 'Organisation';
