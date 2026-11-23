-- I Commit! database, part 5: focus sessions and the weekly jigsaw.
-- Run once in Supabase → SQL Editor after the earlier parts (safe to run again).
--
-- focus_sessions: each stretch of focus time you record on a task (the minutes also go onto the task's day in
--   the app itself; this keeps the history).
-- puzzle_state: your jigsaw progress (see below). Pieces EARNED are worked out from your ticks and completed
--   projects, so they aren't stored.

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  task_id text not null,
  task_name text not null check (char_length(task_name) <= 200),
  day date not null,
  minutes numeric(6, 1) not null check (minutes > 0 and minutes <= 1440),
  mode text not null check (mode in ('up', 'down')),
  started_at timestamptz not null default now()
);

-- Your whole jigsaw state in one private row: the pieces-in-the-pool start date, your series (what you asked for and
-- the next picture in each), the puzzle in progress, and the archive of finished ones.
create table if not exists public.puzzle_state (
  user_id uuid primary key references public.profiles on delete cascade default auth.uid(),
  state jsonb not null default '{}' check (pg_column_size(state) < 400000),
  updated_at timestamptz not null default now()
);

-- A project you mark complete earns jigsaw pieces (30, or 10 per week for long projects).
alter table public.projects add column if not exists done_on date;

alter table public.focus_sessions enable row level security;
alter table public.puzzle_state enable row level security;

drop policy if exists "your focus sessions" on public.focus_sessions;
create policy "your focus sessions" on public.focus_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "your puzzles" on public.puzzle_weeks;  -- the old weekly table (never filled in a released version)
drop policy if exists "your puzzle state" on public.puzzle_state;
create policy "your puzzle state" on public.puzzle_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
