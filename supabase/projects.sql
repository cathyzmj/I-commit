-- I Commit! database, part 3: Gallery projects (timeline, meetings, task board).
-- Run once in Supabase → SQL Editor after parts 1 and 2 (safe to run again).
--
-- A project has a start week and a number of weeks; its steps span weeks, its meetings sit in a
-- week (on a chosen weekday), and its task board holds idea cards (with links between them for
-- brainstorming, and an order for sorting). For now only the owner sees a project; can_use_project()
-- is the one place to widen that when projects are shared with teammates.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'blue',      -- a preset name or any '#rrggbb' (checked below)
  start_date date not null,                 -- the Monday of week 1
  weeks int not null default 8,
  notion_url text not null default '' check (char_length(notion_url) <= 500),
  drive_url text not null default '' check (char_length(drive_url) <= 500),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Added later; these lines also upgrade a table made by an earlier version of this file.
alter table public.projects add column if not exists layout text not null default 'weeks';  -- 'weeks' (Gantt) or 'months' (calendar)
alter table public.projects add column if not exists logo text not null default '';         -- a small picture as a data: URL
alter table public.projects drop constraint if exists projects_color_check;
alter table public.projects add constraint projects_color_check
  check (color in ('blue', 'purple', 'teal', 'coral', 'pink', 'amber', 'green', 'gray') or color ~ '^#[0-9a-f]{6}$');
alter table public.projects drop constraint if exists projects_weeks_check;
alter table public.projects add constraint projects_weeks_check check (weeks between 1 and 60);
alter table public.projects drop constraint if exists projects_layout_check;
alter table public.projects add constraint projects_layout_check check (layout in ('weeks', 'months'));
alter table public.projects drop constraint if exists projects_logo_check;
alter table public.projects add constraint projects_logo_check
  check (logo = '' or (char_length(logo) <= 200000 and logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'));

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  week_from int not null check (week_from >= 1),
  week_to int not null,
  done boolean not null default false,
  sort int not null default 0,
  check (week_to >= week_from)
);

create table if not exists public.project_meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null default 'checkin' check (kind in ('kickoff', 'checkin', 'mid', 'final', 'other')),
  week int not null check (week >= 1),
  weekday int not null default 1 check (weekday between 1 and 7),   -- 1 = Monday
  time time
);

create table if not exists public.project_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  text text not null default '' check (char_length(text) <= 400),
  color text not null default 'amber',
  x real not null default 20,
  y real not null default 20,
  rank int not null default 0,              -- order in Sort mode
  week int,                                 -- planned week (Sort mode)
  task_id text,                             -- the task it became ("To task")
  created_at timestamptz not null default now()
);

create table if not exists public.project_links (
  project_id uuid not null references public.projects on delete cascade,
  from_card uuid not null references public.project_cards on delete cascade,
  to_card uuid not null references public.project_cards on delete cascade,
  primary key (from_card, to_card),
  check (from_card <> to_card)
);

-- Reference links (articles, decks, reports) kept with a project.
create table if not exists public.project_refs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  url text not null check (char_length(url) between 1 and 1000),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Files (Drive, OneDrive, decks, PDFs…) are kept in the same list as references, marked 'file'.
alter table public.project_refs add column if not exists kind text not null default 'ref';
alter table public.project_refs drop constraint if exists project_refs_kind_check;
alter table public.project_refs add constraint project_refs_kind_check check (kind in ('ref', 'file'));
-- A project's old single "Drive or OneDrive folder" link becomes its first file.
insert into public.project_refs (project_id, url, kind)
  select id, drive_url, 'file' from public.projects where drive_url <> '';
update public.projects set drive_url = '' where drive_url <> '';

create or replace function public.can_use_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p and owner = auth.uid()) $$;

alter table public.projects enable row level security;
alter table public.project_steps enable row level security;
alter table public.project_meetings enable row level security;
alter table public.project_cards enable row level security;
alter table public.project_links enable row level security;
alter table public.project_refs enable row level security;

drop policy if exists "your projects" on public.projects;
create policy "your projects" on public.projects for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "steps of your projects" on public.project_steps;
create policy "steps of your projects" on public.project_steps for all to authenticated
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
drop policy if exists "meetings of your projects" on public.project_meetings;
create policy "meetings of your projects" on public.project_meetings for all to authenticated
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
drop policy if exists "cards of your projects" on public.project_cards;
create policy "cards of your projects" on public.project_cards for all to authenticated
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
drop policy if exists "links of your projects" on public.project_links;
create policy "links of your projects" on public.project_links for all to authenticated
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
drop policy if exists "references of your projects" on public.project_refs;
create policy "references of your projects" on public.project_refs for all to authenticated
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));

revoke execute on function public.can_use_project(uuid) from anon, public;
grant execute on function public.can_use_project(uuid) to authenticated;
