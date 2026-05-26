-- Reddit-hosted videos were being linked via media.reddit_video.fallback_url,
-- which is Reddit's video-only DASH stream — audio is a separate stream that
-- Reddit's web player muxes at runtime. So clicking through played the video
-- silently.
--
-- Code fix: link to the Reddit permalink (player has sound) and use the
-- v.redd.it base URL only as a dedup key.
--
-- This migration purges any existing v.redd.it-canonical'd stories so the
-- next ingest regenerates them with correct play URLs. CASCADE clears
-- story_signals, rankings, feedback.

delete from stories
 where canonical_url like 'https://v.redd.it/%';
