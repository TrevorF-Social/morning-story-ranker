-- Persisted log of ingest + rank runs. The dashboard reads the most recent
-- row per vertical to render the "Reddit unavailable" banner and to show the
-- "last refreshed at" timestamp on the header. Also useful for debugging
-- cron health later.
create table ingest_runs (
  id              bigserial primary key,
  vertical        text not null,
  started_at      timestamptz not null,
  finished_at     timestamptz not null default now(),
  ingest_report   jsonb not null,
  ranking_report  jsonb not null,
  triggered_by    text not null check (triggered_by in ('cron', 'refresh')),
  user_email      text,    -- set when triggered_by = 'refresh'
  forced          boolean not null default false
);
create index ingest_runs_vertical_idx on ingest_runs (vertical, started_at desc);
