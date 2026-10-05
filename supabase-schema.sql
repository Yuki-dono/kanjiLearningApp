-- ============================================================================
--  KanjiLearn — Supabase schema
--  Run this once in Supabase Dashboard → SQL Editor. Safe to re-run.
--  Everything a user does stays private: RLS pins every table to auth.uid().
-- ============================================================================

-- 1 ── profile (one row per account, auto-created on sign-up) ---------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  level          text    not null default 'N4',
  xp             integer not null default 0,
  streak         integer not null default 0,
  longest_streak integer not null default 0,
  kanji_graded   integer not null default 0,
  days_active    integer not null default 0,
  last_active    date,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

-- 2 ── study settings (one row per account) --------------------------------
create table if not exists public.study_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  level      text   not null default 'N4',
  goal       integer not null default 5,
  scope      text[] not null default array['N5','N4']::text[],
  updated_at timestamptz not null default now()
);

-- 3 ── SRS memory: one row per kanji the user has seen ----------------------
create table if not exists public.srs_cards (
  user_id    uuid    not null references auth.users (id) on delete cascade,
  character  text    not null,
  level      text,
  reps       integer not null default 0,
  lapses     integer not null default 0,
  ease       real    not null default 2.5,
  interval   integer not null default 0,
  due        date    not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (user_id, character)
);
create index if not exists srs_cards_due_idx on public.srs_cards (user_id, due);

-- 4 ── daily activity: one row per studied day -----------------------------
create table if not exists public.study_days (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  day        date   not null,
  new_chars  text[] not null default '{}'::text[],
  graded     jsonb  not null default '{}'::jsonb,
  sess       jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- 5 ── quiz history -------------------------------------------------------
create table if not exists public.quiz_scores (
  id         bigint generated always as identity primary key,
  user_id    uuid    not null references auth.users (id) on delete cascade,
  mode       text    not null,
  scope      text[]  not null default '{}'::text[],
  learned    boolean not null default false,
  score      integer not null,
  total      integer not null,
  pct        integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists quiz_scores_recent_idx on public.quiz_scores (user_id, created_at desc);

-- 6 ── vocabulary the user typed in themselves -----------------------------
create table if not exists public.custom_words (
  id         bigint generated always as identity primary key,
  user_id    uuid    not null references auth.users (id) on delete cascade,
  word       text    not null,
  reading    text    not null default '',
  meaning    text    not null default '',
  parts      text,
  created_at timestamptz not null default now(),
  unique (user_id, word)
);

-- ============================================================================
--  Row level security — every table is readable/writable only by its owner
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.study_settings enable row level security;
alter table public.srs_cards      enable row level security;
alter table public.study_days     enable row level security;
alter table public.quiz_scores    enable row level security;
alter table public.custom_words   enable row level security;

-- profiles is keyed by `id` (1:1 with auth.users); every other table by `user_id`
drop policy if exists "owner read"  on public.profiles;
drop policy if exists "owner write" on public.profiles;
drop policy if exists "owner update" on public.profiles;
create policy "owner read"  on public.profiles for select using (auth.uid() = id);
create policy "owner write" on public.profiles for insert with check (auth.uid() = id);
create policy "owner update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'study_settings','srs_cards','study_days','quiz_scores','custom_words'
  ] loop
    execute format('drop policy if exists "owner read" on public.%I', t);
    execute format('drop policy if exists "owner write" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format(
      'create policy "owner read" on public.%I for select using (auth.uid() = user_id)', t);
    execute format(
      'create policy "owner write" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "owner update" on public.%I for update using (auth.uid() = user_id)
         with check (auth.uid() = user_id)', t);
    -- "Reset all progress" must also clear the stored copy, so the four
    -- study-data tables allow the owner to delete their own rows
    if t in ('srs_cards','study_days','quiz_scores','custom_words') then
      execute format('drop policy if exists "owner delete" on public.%I', t);
      execute format(
        'create policy "owner delete" on public.%I for delete using (auth.uid() = user_id)', t);
    end if;
  end loop;
end $$;

-- ============================================================================
--  Auto-create the profile row the moment someone signs up
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, last_seen_at)
  values (new.id, new.email, now())
  on conflict (id) do update set email = excluded.email;
  insert into public.study_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for any account created before this trigger existed
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ============================================================================
--  Notes
--  · The old single-blob `progress` table is left untouched (unused).
--    Drop it with:  drop table if exists public.progress;
--  · Email confirmation lives in Dashboard → Authentication → Providers.
--    Leave "Confirm email" ON so nobody can squat on your address.
--  · This file is safe to re-run: tables are created if missing, policies are
--    dropped and recreated.
-- ============================================================================