-- Trim r/GlobalOffensive and r/leagueoflegends from the video section.
-- Same pattern as 0005 (LivestreamFail): deactivate the source and delete
-- existing stories so the change shows up in the current snapshot, not
-- after a 24h window roll-off.

update sources
   set active = false
 where kind = 'reddit'
   and sub_name in ('GlobalOffensive', 'leagueoflegends');

delete from stories
 where source_id in (
   select id from sources
    where kind = 'reddit'
      and sub_name in ('GlobalOffensive', 'leagueoflegends')
 );
