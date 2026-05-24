-- r/LivestreamFail is structurally too clip-heavy and was crowding out
-- other subs in the video section despite per-sub p95 normalization.
-- Deactivate the source (so future ingests skip it) and delete its existing
-- stories so the current snapshot reflects the change immediately.
--
-- CASCADE removes the associated story_signals, rankings, and feedback rows
-- (per the FK constraints in 0001_init.sql).

update sources
   set active = false
 where kind = 'reddit'
   and sub_name = 'LivestreamFail';

delete from stories
 where source_id in (
   select id from sources
    where kind = 'reddit'
      and sub_name = 'LivestreamFail'
 );
