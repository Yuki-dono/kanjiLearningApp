-- Kanji Practice — Supabase schema (run once in Supabase Dashboard → SQL Editor)
-- Stores one progress document per user (SRS memory, daily days, streak,
-- quiz bests, custom words). Row-level security: users touch only their own row.

create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

drop policy if exists "own progress row" on public.progress;
create policy "own progress row" on public.progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
