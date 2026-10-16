-- I Commit! database, part 1: accounts, Work Buddy pacts and shared calendars.
-- Run it once in Supabase → SQL Editor → New query → paste → Run. Safe to run again (it replaces
-- functions and policies; tables are only created if missing).
--
-- Who can see what (enforced by the database, whatever the app asks for):
--   • your profile, events and ticks: you
--   • a pact, its members and their daily ticks: people in that pact
--   • an invite: people in that pact, and the person whose Gmail it's for
--   • your calendar events: your pact buddies, only if you turned sharing on
--     ("busy" hides the event names; "off" shows nothing)

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  name text not null default '',
  share_calendar text not null default 'off' check (share_calendar in ('off', 'busy', 'names')),
  created_at timestamptz not null default now()
);

create table if not exists public.pacts (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Daily online test' check (char_length(name) between 1 and 60),
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.pact_members (
  pact_id uuid not null references public.pacts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pact_id, user_id)
);

create table if not exists public.pact_invites (
  pact_id uuid not null references public.pacts on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  invited_by uuid not null references public.profiles on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (pact_id, email)
);

-- One row per person per day they finished the pact's routine.
create table if not exists public.pact_days (
  pact_id uuid not null references public.pacts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  day date not null,
  note text not null default '' check (char_length(note) <= 140),
  done_at timestamptz not null default now(),
  primary key (pact_id, user_id, day)
);

-- Your calendar events (timetable and one-offs), kept up to date by the app.
create table if not exists public.events (
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  id text not null,
  day date not null,
  starts time,
  ends time,
  title text not null default '' check (char_length(title) <= 120),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists events_by_day on public.events (user_id, day);

-- ---------- A profile for every new sign-in ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Helpers for the rules (they read the tables directly, so rules don't loop) ----------
create or replace function public.my_email() returns text
language sql stable set search_path = '' as $$ select lower(auth.jwt() ->> 'email') $$;

create or replace function public.in_pact(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pact_members where pact_id = p and user_id = auth.uid()) $$;

create or replace function public.invited_to(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pact_invites where pact_id = p and email = public.my_email()) $$;

-- Someone you share a pact with, or who invited you.
create or replace function public.can_see_profile(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target = auth.uid()
      or exists (select 1 from public.pact_members a join public.pact_members b on a.pact_id = b.pact_id
                 where a.user_id = auth.uid() and b.user_id = target)
      or exists (select 1 from public.pact_invites i join public.pact_members m on m.pact_id = i.pact_id
                 where i.email = public.my_email() and m.user_id = target) $$;

-- ---------- Rules (row level security) ----------
alter table public.profiles enable row level security;
alter table public.pacts enable row level security;
alter table public.pact_members enable row level security;
alter table public.pact_invites enable row level security;
alter table public.pact_days enable row level security;
alter table public.events enable row level security;

drop policy if exists "see people you share a pact with" on public.profiles;
create policy "see people you share a pact with" on public.profiles for select to authenticated using (public.can_see_profile(id));
drop policy if exists "change your own profile" on public.profiles;
create policy "change your own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "see your pacts and invites" on public.pacts;
create policy "see your pacts and invites" on public.pacts for select to authenticated using (public.in_pact(id) or public.invited_to(id));
drop policy if exists "rename your pact" on public.pacts;
create policy "rename your pact" on public.pacts for update to authenticated using (public.in_pact(id)) with check (public.in_pact(id));

drop policy if exists "see who is in your pacts" on public.pact_members;
create policy "see who is in your pacts" on public.pact_members for select to authenticated using (public.in_pact(pact_id));

drop policy if exists "see invites" on public.pact_invites;
create policy "see invites" on public.pact_invites for select to authenticated using (public.in_pact(pact_id) or email = public.my_email());
drop policy if exists "invite to your pact" on public.pact_invites;
create policy "invite to your pact" on public.pact_invites for insert to authenticated with check (public.in_pact(pact_id) and invited_by = auth.uid());
drop policy if exists "take back or decline an invite" on public.pact_invites;
create policy "take back or decline an invite" on public.pact_invites for delete to authenticated using (public.in_pact(pact_id) or email = public.my_email());

drop policy if exists "see ticks in your pacts" on public.pact_days;
create policy "see ticks in your pacts" on public.pact_days for select to authenticated using (public.in_pact(pact_id));
drop policy if exists "tick your own days" on public.pact_days;
create policy "tick your own days" on public.pact_days for insert to authenticated with check (user_id = auth.uid() and public.in_pact(pact_id));
drop policy if exists "change your own ticks" on public.pact_days;
create policy "change your own ticks" on public.pact_days for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "untick your own days" on public.pact_days;
create policy "untick your own days" on public.pact_days for delete to authenticated using (user_id = auth.uid());

drop policy if exists "your own events" on public.events;
create policy "your own events" on public.events for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Actions the app calls ----------
create or replace function public.create_pact(pact_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.pacts (name, created_by) values (coalesce(nullif(trim(pact_name), ''), 'Daily online test'), auth.uid()) returning id into pid;
  insert into public.pact_members (pact_id, user_id) values (pid, auth.uid());
  return pid;
end $$;

create or replace function public.accept_invite(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.invited_to(p) then raise exception 'This invite was taken back.'; end if;
  if (select count(*) from public.pact_members where pact_id = p) >= 6 then raise exception 'This pact is full.'; end if;
  insert into public.pact_members (pact_id, user_id) values (p, auth.uid()) on conflict do nothing;
  delete from public.pact_invites where pact_id = p and email = public.my_email();
end $$;

-- Leaving removes your ticks there too; the last person leaving deletes the pact.
create or replace function public.leave_pact(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pact_days where pact_id = p and user_id = auth.uid();
  delete from public.pact_members where pact_id = p and user_id = auth.uid();
  if not exists (select 1 from public.pact_members where pact_id = p) then delete from public.pacts where id = p; end if;
end $$;

-- Invites to your Gmail, with the names of the people inviting you.
create or replace function public.my_invites() returns table (pact_id uuid, pact_name text, from_names text[])
language sql stable security definer set search_path = '' as $$
  select i.pact_id, p.name, array(select pr.name from public.pact_members m join public.profiles pr on pr.id = m.user_id where m.pact_id = i.pact_id order by m.joined_at)
  from public.pact_invites i join public.pacts p on p.id = i.pact_id
  where i.email = public.my_email() $$;

-- Your buddies' calendars for a range of days, as each of them chose to share it.
create or replace function public.buddy_events(day_from date, day_to date)
returns table (user_id uuid, name text, day date, starts time, ends time, title text)
language sql stable security definer set search_path = '' as $$
  select e.user_id, pr.name, e.day, e.starts, e.ends, case when pr.share_calendar = 'names' then e.title else '' end
  from public.events e join public.profiles pr on pr.id = e.user_id
  where e.user_id <> auth.uid() and pr.share_calendar <> 'off'
    and exists (select 1 from public.pact_members a join public.pact_members b on a.pact_id = b.pact_id
                where a.user_id = auth.uid() and b.user_id = e.user_id)
    and e.day between day_from and day_to
  order by e.day, e.starts nulls first $$;

revoke execute on function public.create_pact(text), public.accept_invite(uuid), public.leave_pact(uuid),
  public.my_invites(), public.buddy_events(date, date) from anon, public;
grant execute on function public.create_pact(text), public.accept_invite(uuid), public.leave_pact(uuid),
  public.my_invites(), public.buddy_events(date, date) to authenticated;

-- ---------- Live updates (a buddy's tick or a new invite shows up straight away) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.pact_days; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pact_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pact_invites; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;
