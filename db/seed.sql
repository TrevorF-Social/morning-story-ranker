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

insert into sources (vertical, kind, name, sub_name, authority_weight) values
  -- News + general gaming subs
  ('gaming', 'reddit', 'r/Games',                  'Games',                  0.60),
  ('gaming', 'reddit', 'r/gaming',                 'gaming',                 0.60),
  ('gaming', 'reddit', 'r/pcgaming',               'pcgaming',               0.60),
  ('gaming', 'reddit', 'r/PS5',                    'PS5',                    0.60),
  ('gaming', 'reddit', 'r/XboxSeriesX',            'XboxSeriesX',            0.60),
  ('gaming', 'reddit', 'r/NintendoSwitch',         'NintendoSwitch',         0.60),
  ('gaming', 'reddit', 'r/GamingLeaksAndRumours',  'GamingLeaksAndRumours',  0.60),
  -- Clip-focused subs. Posts here are almost always videos; ingest classifies
  -- each post and routes videos to stories.kind='video'.
  ('gaming', 'reddit', 'r/gamingclips',            'gamingclips',            0.60),
  -- Game-specific subs (high video activity for the video section)
  ('gaming', 'reddit', 'r/leagueoflegends',        'leagueoflegends',        0.60),
  ('gaming', 'reddit', 'r/VALORANT',               'VALORANT',               0.60),
  ('gaming', 'reddit', 'r/Overwatch',              'Overwatch',              0.60),
  ('gaming', 'reddit', 'r/GlobalOffensive',        'GlobalOffensive',        0.60),
  ('gaming', 'reddit', 'r/apexlegends',            'apexlegends',            0.60),
  ('gaming', 'reddit', 'r/FortNiteBR',             'FortNiteBR',             0.60),
  ('gaming', 'reddit', 'r/wow',                    'wow',                    0.60),
  ('gaming', 'reddit', 'r/Eldenring',              'Eldenring',              0.60),
  ('gaming', 'reddit', 'r/Helldivers',             'Helldivers',             0.60),
  ('gaming', 'reddit', 'r/baldursgate3',           'baldursgate3',           0.60),
  ('gaming', 'reddit', 'r/EscapefromTarkov',       'EscapefromTarkov',       0.60),
  ('gaming', 'reddit', 'r/destiny2',               'destiny2',               0.60),
  ('gaming', 'reddit', 'r/subnautica',             'subnautica',             0.60),
  ('gaming', 'reddit', 'r/CrimsonDesert',          'CrimsonDesert',          0.60)
on conflict (kind, domain, sub_name) do nothing;
