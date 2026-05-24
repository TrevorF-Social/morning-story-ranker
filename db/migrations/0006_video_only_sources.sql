-- Game-specific subs (r/baldursgate3, r/VALORANT, etc.) were intended to feed
-- the video section only. But Reddit posts that AREN'T videos (screenshots,
-- discussion threads, memes) were getting ingested as kind='news' and, thanks
-- to their high raw upvote volume, drowning out outlet RSS stories in the
-- news ranking.
--
-- Fix: source-level flag. video_only=true means non-video posts from this
-- source are dropped at ingest. News-leaning subs (r/Games, r/pcgaming,
-- r/PS5, etc.) stay video_only=false and continue to contribute both kinds.

alter table sources
  add column video_only boolean not null default false;

-- Flag the clip-focused sub and every game-specific sub.
update sources
   set video_only = true
 where kind = 'reddit'
   and sub_name in (
     'gamingclips',
     'leagueoflegends', 'VALORANT', 'Overwatch', 'GlobalOffensive',
     'apexlegends', 'FortNiteBR', 'wow', 'Eldenring',
     'Helldivers', 'baldursgate3', 'EscapefromTarkov', 'destiny2',
     'subnautica', 'CrimsonDesert'
   );

-- Purge the news stories that came from these sources before the flag
-- existed. CASCADE wipes their story_signals + rankings + feedback rows.
delete from stories
 where kind = 'news'
   and source_id in (select id from sources where video_only = true);
