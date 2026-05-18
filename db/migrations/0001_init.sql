-- Morning Story Ranker — initial schema.
-- Run against Neon (or any Postgres 14+) once. Future migrations live as 0002_*.sql etc.

create extension if not exists pgcrypto;

-- Sources: seeded with outlet RSS feeds and Reddit subs for week 1.
-- `kind` is 'rss' or 'reddit'. For 'rss', `domain` is the canonical host
-- (lowercased, no www). For 'reddit', `sub_name` is the sub without "r/".
create table sources (
  id              bigserial primary key,
  vertical        text not null,
  kind            text not null check (kind in ('rss', 'reddit')),
  name            text not null,
  feed_url        text,              -- rss only
  domain          text,              -- rss only; canonical host
  sub_name        text,              -- reddit only
  authority_weight numeric(3,2) not null,  -- 0.00–1.00
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  -- NULLS NOT DISTINCT (PG15+) so Reddit rows (domain IS NULL) and RSS rows
  -- (sub_name IS NULL) still get uniqueness, making the seed idempotent.
  unique nulls not distinct (kind, domain, sub_name)
);
create index sources_vertical_active_idx on sources (vertical, active);

-- Stories: one row per unique canonical URL. RSS items create rows; Reddit
-- posts linking to an existing canonical URL attach as a story_signal
-- rather than creating a duplicate (see Data Inputs in PRD).
-- Reddit self-posts and Reddit posts linking to non-outlet URLs create
-- their own story with source pointing to the relevant reddit sub source row.
create table stories (
  id              bigserial primary key,
  vertical        text not null,
  canonical_url   text not null,
  source_id       bigint not null references sources(id),
  title           text not null,
  url             text not null,        -- raw URL we discovered it at
  hero_image_url  text,
  summary         text,
  published_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (canonical_url)
);
create index stories_vertical_published_idx on stories (vertical, published_at desc);

-- Story signals: Reddit data attached to a story. A single story can have
-- multiple signal rows (e.g. r/Games AND r/pcgaming both surface it).
create table story_signals (
  id              bigserial primary key,
  story_id        bigint not null references stories(id) on delete cascade,
  kind            text not null check (kind in ('reddit')),
  sub_name        text not null,
  upvotes         integer not null,
  comments        integer not null,
  reddit_permalink text not null,
  fetched_at      timestamptz not null default now(),
  unique (story_id, sub_name)
);
create index story_signals_story_idx on story_signals (story_id);

-- Rankings: one row per (snapshot_date, vertical, story). The cron writes
-- a new snapshot per day; the Refresh button updates today's snapshot in
-- place via upsert (no new row per click — see PRD Core User Flow).
create table rankings (
  id              bigserial primary key,
  snapshot_date   date not null,
  vertical        text not null,
  story_id        bigint not null references stories(id) on delete cascade,
  score           numeric(6,4) not null,
  score_breakdown jsonb not null,      -- {recency, authority, reddit_engagement, ...}
  rank            integer not null,
  seen_before     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (snapshot_date, vertical, story_id)
);
create index rankings_snapshot_idx on rankings (snapshot_date, vertical, rank);

-- Feedback: Posted/Skipped/Saved actions. Feedback persists forever — the
-- suppression of previously-actioned stories is a join, not a delete.
create table feedback (
  id              bigserial primary key,
  story_id        bigint not null references stories(id) on delete cascade,
  action          text not null check (action in ('posted', 'skipped', 'saved')),
  reason          text,                -- nullable; only set for some skips
  user_email      text not null,
  created_at      timestamptz not null default now()
);
create index feedback_story_idx on feedback (story_id, created_at desc);
create index feedback_email_idx on feedback (user_email, created_at desc);

-- Allowed emails: magic-link requests for non-allowlisted addresses silently
-- no-op. Maintained via a one-off admin script in week 1.
create table allowed_emails (
  email           text primary key,
  created_at      timestamptz not null default now()
);

-- Magic link tokens: one-time-use, 15-minute expiry. token_hash is sha256
-- so a DB compromise doesn't yield usable tokens. used_at marks consumption.
create table magic_link_tokens (
  id              bigserial primary key,
  email           text not null,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index magic_link_tokens_email_idx on magic_link_tokens (email, created_at desc);
