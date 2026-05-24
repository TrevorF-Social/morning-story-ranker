-- Story kind: 'news' or 'video'. Videos surface in a separate dashboard
-- section and are excluded from the main news ranking (PRD-aligned: video
-- clips are a distinct content type, not just another story).
--
-- Backfill: every existing row gets the default 'news'. The check constraint
-- prevents typos at write time.

alter table stories
  add column kind text not null default 'news'
  check (kind in ('news', 'video'));

-- Dashboard reads "today's top N for vertical+kind" — this index supports
-- that path. Also useful for "stories from the last 24h for this kind"
-- during ranking.
create index stories_vertical_kind_published_idx
  on stories (vertical, kind, published_at desc);
