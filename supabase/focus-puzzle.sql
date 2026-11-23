-- I Commit! database, part 5: focus sessions and the weekly jigsaw.
-- Run once in Supabase → SQL Editor after the earlier parts (safe to run again).
--
-- focus_sessions: each stretch of focus time you record on a task (the minutes also go onto the task's day in
--   the app itself; this keeps the history).
-- puzzle_weeks: each week's jigsaw: which picture it is, which pieces you've put in place, and the grid once
--   you've started placing (so adding a routine mid-week can't reshuffle the board). Pieces EARNED are worked
--   out from your ticks, so they aren't stored.

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

create table if not exists public.puzzle_weeks (
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  week date not null,                                   -- the Monday
  image jsonb not null default '{}' check (pg_column_size(image) < 6000),
  lock jsonb check (lock is null or pg_column_size(lock) < 200),   -- {cols, rows}, set at the first placed piece
  placed int[] not null default '{}' check (cardinality(placed) <= 80),
  seen int not null default 0 check (seen between 0 and 80),
  updated_at timestamptz not null default now(),
  primary key (user_id, week)
);

alter table public.focus_sessions enable row level security;
alter table public.puzzle_weeks enable row level security;

drop policy if exists "your focus sessions" on public.focus_sessions;
create policy "your focus sessions" on public.focus_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "your puzzles" on public.puzzle_weeks;
create policy "your puzzles" on public.puzzle_weeks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
