-- I Commit! database, part 4: Academics (what you've finished in each Moodle course).
-- Run once in Supabase → SQL Editor after the earlier parts (safe to run again).
--
-- The course contents themselves are read from Moodle when you open the tab and are not stored
-- here. Only your own choices are kept, private to you: which items you've ticked off, a notes link
-- per course (e.g. a OneNote section), which courses you track this term, and when term starts.

create table if not exists public.academic_progress (
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  item_id bigint not null,                 -- Moodle's id for the item (course module)
  course_id bigint not null,
  done_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.academic_courses (
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  course_id bigint not null,
  notes_url text not null default '' check (char_length(notes_url) <= 2000),
  tracked boolean not null default false,   -- the courses you're studying this term
  primary key (user_id, course_id)
);

create table if not exists public.academic_settings (
  user_id uuid primary key references public.profiles on delete cascade default auth.uid(),
  term_start date not null default '2026-09-28'      -- the Monday of week 1 (LSE Michaelmas Term 2026)
);

alter table public.academic_progress enable row level security;
alter table public.academic_courses enable row level security;
alter table public.academic_settings enable row level security;

drop policy if exists "your progress" on public.academic_progress;
create policy "your progress" on public.academic_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "your courses" on public.academic_courses;
create policy "your courses" on public.academic_courses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "your term" on public.academic_settings;
create policy "your term" on public.academic_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
