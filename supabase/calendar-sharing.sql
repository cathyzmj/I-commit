-- I Commit! database, part 2: sharing calendars with anyone (not only Work Buddy pacts).
-- Run once in Supabase → SQL Editor after schema.sql (safe to run again).
--
-- You invite someone by Gmail; once they accept, each of you sees the other's calendar
-- ("ours"), each at the level you chose for your own events: "names" or "busy" (times only).
-- Either of you can stop sharing at any time.

create table if not exists public.calendar_links (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles on delete cascade default auth.uid(),
  to_email text not null check (to_email = lower(to_email) and to_email like '%@%'),
  to_user uuid references public.profiles on delete cascade,
  from_level text not null default 'names' check (from_level in ('busy', 'names')),
  to_level text not null default 'names' check (to_level in ('busy', 'names')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (from_user, to_email)
);
alter table public.calendar_links enable row level security;

drop policy if exists "see your calendar links" on public.calendar_links;
create policy "see your calendar links" on public.calendar_links for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or to_email = public.my_email());
drop policy if exists "invite someone to share calendars" on public.calendar_links;
create policy "invite someone to share calendars" on public.calendar_links for insert to authenticated
  with check (from_user = auth.uid() and to_email <> public.my_email() and to_user is null and accepted_at is null);
drop policy if exists "stop sharing calendars" on public.calendar_links;
create policy "stop sharing calendars" on public.calendar_links for delete to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or to_email = public.my_email());

-- Accept an invite sent to your Gmail.
create or replace function public.accept_calendar_link(l uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.calendar_links set to_user = auth.uid(), accepted_at = now()
  where id = l and to_email = public.my_email() and accepted_at is null;
  if not found then raise exception 'This invite was taken back.'; end if;
end $$;

-- How much of YOUR calendar the other person sees.
create or replace function public.set_calendar_level(l uuid, level text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if level not in ('busy', 'names') then raise exception 'Choose busy or names.'; end if;
  update public.calendar_links set from_level = level where id = l and from_user = auth.uid();
  update public.calendar_links set to_level = level where id = l and to_user = auth.uid();
end $$;

-- Everyone you share calendars with (or have invited / been invited by), from your side.
create or replace function public.calendar_people()
returns table (link_id uuid, user_id uuid, name text, email text, accepted boolean, incoming boolean, my_level text, their_level text)
language sql stable security definer set search_path = '' as $$
  select l.id,
         case when l.from_user = auth.uid() then l.to_user else l.from_user end,
         case when l.from_user = auth.uid() then coalesce(t.name, split_part(l.to_email, '@', 1)) else f.name end,
         case when l.from_user = auth.uid() then l.to_email else f.email end,
         l.accepted_at is not null,
         l.from_user <> auth.uid(),
         case when l.from_user = auth.uid() then l.from_level else l.to_level end,
         case when l.from_user = auth.uid() then l.to_level else l.from_level end
  from public.calendar_links l
  join public.profiles f on f.id = l.from_user
  left join public.profiles t on t.id = l.to_user
  where l.from_user = auth.uid() or l.to_user = auth.uid() or (l.to_email = public.my_email() and l.accepted_at is null)
  order by l.created_at $$;

-- Calendars shared with you for a range of days: people you're linked with, at the level each of
-- them chose, plus Work Buddy pact members who share theirs.
create or replace function public.shared_events(day_from date, day_to date)
returns table (user_id uuid, name text, day date, starts time, ends time, title text)
language sql stable security definer set search_path = '' as $$
  with linked as (
    select case when l.from_user = auth.uid() then l.to_user else l.from_user end as other,
           case when l.from_user = auth.uid() then l.to_level else l.from_level end as level
    from public.calendar_links l
    where l.accepted_at is not null and (l.from_user = auth.uid() or l.to_user = auth.uid())
    union
    select b.user_id, pr.share_calendar
    from public.pact_members a join public.pact_members b on a.pact_id = b.pact_id and b.user_id <> a.user_id
    join public.profiles pr on pr.id = b.user_id
    where a.user_id = auth.uid() and pr.share_calendar <> 'off'
  ), best as (
    select other, case when bool_or(level = 'names') then 'names' else 'busy' end as level from linked group by other
  )
  select e.user_id, pr.name, e.day, e.starts, e.ends, case when best.level = 'names' then e.title else '' end
  from best join public.events e on e.user_id = best.other join public.profiles pr on pr.id = e.user_id
  where e.day between day_from and day_to
  order by e.day, e.starts nulls first $$;

revoke execute on function public.accept_calendar_link(uuid), public.set_calendar_level(uuid, text),
  public.calendar_people(), public.shared_events(date, date) from anon, public;
grant execute on function public.accept_calendar_link(uuid), public.set_calendar_level(uuid, text),
  public.calendar_people(), public.shared_events(date, date) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.calendar_links; exception when duplicate_object then null; end;
end $$;
