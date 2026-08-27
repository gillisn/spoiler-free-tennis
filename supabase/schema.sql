-- Spoiler Free Tennis — Supabase schema
-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.

-- The tournament the cron job is currently pulling from, as configured
-- provider-side ids. Kept in the DB rather than only env vars so it can be
-- fixed or swapped from Supabase's Table Editor with no Vercel redeploy —
-- useful while still confirming the right ATP/WTA ids, and later for
-- moving on to the next event without touching code.
create table if not exists tournaments (
  slug text primary key,          -- e.g. 'us-open-2026'
  label text not null,            -- e.g. 'US Open' — shown on the site/caption
  atp_tournament_id text,         -- provider's numeric id, as a string; null if not yet known
  wta_tournament_id text,
  active boolean not null default true, -- the cron job uses whichever row is active
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id text primary key,
  tour text not null check (tour in ('ATP', 'WTA')),
  tournament text not null,
  round text,
  player_a text not null,
  player_b text not null,
  seed_a int,
  seed_b int,
  winner text not null check (winner in ('A', 'B')),
  sets jsonb not null,
  completed_date date not null,
  hot_shot text,
  drama_score numeric,
  drama_reasons jsonb,
  suggested_start text,
  estimated_minutes int,
  created_at timestamptz not null default now()
);

create index if not exists matches_completed_date_idx on matches (completed_date);

-- One row per day the digest was generated, with the ranked top N frozen in.
-- This is what the website reads to render "Yesterday's Top 5" and it's
-- also what the Instagram caption/image is generated from, so a post never
-- silently changes after publishing even if the source API's data shifts.
create table if not exists daily_digests (
  digest_date date primary key,
  tournament text not null,
  ranked_match_ids jsonb not null, -- ordered array of match ids, rank 1 first
  generated_at timestamptz not null default now(),
  instagram_media_id text,
  instagram_posted_at timestamptz
);

-- Row Level Security: the site's public pages only need read access;
-- writes happen server-side with the service role key, which bypasses RLS.
alter table tournaments enable row level security;
alter table matches enable row level security;
alter table daily_digests enable row level security;

drop policy if exists "public read tournaments" on tournaments;
create policy "public read tournaments" on tournaments for select using (true);

drop policy if exists "public read matches" on matches;
create policy "public read matches" on matches for select using (true);

drop policy if exists "public read digests" on daily_digests;
create policy "public read digests" on daily_digests for select using (true);

-- Seed row for the trial. Both ids confirmed:
--   ATP 21349 — "U.S. Open - New York", 2026-08-31, tier "Grand Slam"
--   WTA 16743
-- Safe to re-run: upserts on the slug.
insert into tournaments (slug, label, atp_tournament_id, wta_tournament_id, active)
values ('us-open-2026', 'US Open', '21349', '16743', true)
on conflict (slug) do update set
  atp_tournament_id = excluded.atp_tournament_id,
  wta_tournament_id = excluded.wta_tournament_id;
