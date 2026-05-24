-- Seed sources for the gaming vertical (week 1 pilot).
-- Authority tiers from PRD: t1=1.0, t2=0.9, t3=0.7, reddit=0.6.
-- Idempotent: re-running won't duplicate.

insert into sources (vertical, kind, name, feed_url, domain, authority_weight) values
  ('gaming', 'rss', 'IGN',       'https://feeds.feedburner.com/ign/games-all',   'ign.com',       1.00),
  ('gaming', 'rss', 'Polygon',   'https://www.polygon.com/rss/index.xml',         'polygon.com',   1.00),
  ('gaming', 'rss', 'Kotaku',    'https://kotaku.com/rss',                        'kotaku.com',    0.90),
  ('gaming', 'rss', 'Eurogamer', 'https://www.eurogamer.net/feed',                'eurogamer.net', 0.90),
  ('gaming', 'rss', 'PC Gamer',  'https://www.pcgamer.com/rss/',                  'pcgamer.com',   0.90)
on conflict (kind, domain, sub_name) do nothing;

-- News-leaning subs contribute to both news and video sections.
insert into sources (vertical, kind, name, sub_name, authority_weight, video_only) values
  ('gaming', 'reddit', 'r/Games',                  'Games',                  0.60, false),
  ('gaming', 'reddit', 'r/gaming',                 'gaming',                 0.60, false),
  ('gaming', 'reddit', 'r/pcgaming',               'pcgaming',               0.60, false),
  ('gaming', 'reddit', 'r/PS5',                    'PS5',                    0.60, false),
  ('gaming', 'reddit', 'r/XboxSeriesX',            'XboxSeriesX',            0.60, false),
  ('gaming', 'reddit', 'r/NintendoSwitch',         'NintendoSwitch',         0.60, false),
  ('gaming', 'reddit', 'r/GamingLeaksAndRumours',  'GamingLeaksAndRumours',  0.60, false)
on conflict (kind, domain, sub_name) do nothing;

-- video_only=true: clip aggregators + game-specific subs. Their non-video
-- posts (screenshots, discussion threads, memes) are dropped at ingest so
-- they don't crowd out outlet articles in the news ranking.
insert into sources (vertical, kind, name, sub_name, authority_weight, video_only) values
  ('gaming', 'reddit', 'r/gamingclips',            'gamingclips',            0.60, true),
  ('gaming', 'reddit', 'r/leagueoflegends',        'leagueoflegends',        0.60, true),
  ('gaming', 'reddit', 'r/VALORANT',               'VALORANT',               0.60, true),
  ('gaming', 'reddit', 'r/Overwatch',              'Overwatch',              0.60, true),
  ('gaming', 'reddit', 'r/GlobalOffensive',        'GlobalOffensive',        0.60, true),
  ('gaming', 'reddit', 'r/apexlegends',            'apexlegends',            0.60, true),
  ('gaming', 'reddit', 'r/FortNiteBR',             'FortNiteBR',             0.60, true),
  ('gaming', 'reddit', 'r/wow',                    'wow',                    0.60, true),
  ('gaming', 'reddit', 'r/Eldenring',              'Eldenring',              0.60, true),
  ('gaming', 'reddit', 'r/Helldivers',             'Helldivers',             0.60, true),
  ('gaming', 'reddit', 'r/baldursgate3',           'baldursgate3',           0.60, true),
  ('gaming', 'reddit', 'r/EscapefromTarkov',       'EscapefromTarkov',       0.60, true),
  ('gaming', 'reddit', 'r/destiny2',               'destiny2',               0.60, true),
  ('gaming', 'reddit', 'r/subnautica',             'subnautica',             0.60, true),
  ('gaming', 'reddit', 'r/CrimsonDesert',          'CrimsonDesert',          0.60, true)
on conflict (kind, domain, sub_name) do nothing;
