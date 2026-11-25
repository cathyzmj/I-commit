-- I Commit! database, part 6: "Build a tree together" (the daily tasks you share with your buddy).
-- Run once in Supabase → SQL Editor after the earlier parts (safe to run again).
--
-- pact_tasks: the tasks you both do every day; either of you can add or remove them.
-- pact_task_ticks: who ticked which task on which day (you can only tick for yourself).
-- When you have ticked every task, the app records your day in pact_days (part 1); the tree grows on days
-- everyone in the pact has done that, so adding a task later never rewrites past days. The tree itself is
-- worked out from those days, so it isn't stored.

create table if not exists public.pact_tasks (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (pact_id, title)
);

create table if not exists public.pact_task_ticks (
  task_id uuid not null references public.pact_tasks on delete cascade,
  pact_id uuid not null references public.pacts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  day date not null,
  done_at timestamptz not null default now(),
  primary key (task_id, user_id, day)
);
create index if not exists pact_task_ticks_by_day on public.pact_task_ticks (pact_id, day);

alter table public.pact_tasks enable row level security;
alter table public.pact_task_ticks enable row level security;

drop policy if exists "your pact's tasks" on public.pact_tasks;
create policy "your pact's tasks" on public.pact_tasks for all to authenticated
  using (public.in_pact(pact_id)) with check (public.in_pact(pact_id));

drop policy if exists "see task ticks in your pacts" on public.pact_task_ticks;
create policy "see task ticks in your pacts" on public.pact_task_ticks for select to authenticated using (public.in_pact(pact_id));
drop policy if exists "tick tasks for yourself" on public.pact_task_ticks;
create policy "tick tasks for yourself" on public.pact_task_ticks for insert to authenticated
  with check (user_id = auth.uid() and public.in_pact(pact_id)
    and exists (select 1 from public.pact_tasks t where t.id = task_id and t.pact_id = pact_task_ticks.pact_id));
drop policy if exists "untick your own tasks" on public.pact_task_ticks;
create policy "untick your own tasks" on public.pact_task_ticks for delete to authenticated using (user_id = auth.uid());

do $$ begin
  begin alter publication supabase_realtime add table public.pact_tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pact_task_ticks; exception when duplicate_object then null; end;
end $$;
