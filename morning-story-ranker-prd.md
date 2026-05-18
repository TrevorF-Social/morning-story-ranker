# Morning Story Ranker — PRD

> **Pivot history**
> - **2026-05-16**: Originally scoped to rank Valnet's own published stories from CMS + GA4. Reworked: Valnet's existing social tool covers own-story surfacing. App pivoted to scrape **top gaming stories across the open web** so the team can riff on the vertical socially.
> - **2026-05-18**: Dropped GameRant-specific framing, brand-voice captions, and Valnet-property filtering — internal tools already cover those. Repositioned as a general gaming-vertical trend dashboard: ranked external stories with explainable scores and personal triage state. No caption generation, no brand-voice tuning, no LLM at all in MVP.

An internal dashboard that scans the last 24 hours of gaming coverage across the open web every morning and surfaces what's worth knowing, ranked and explained.

## Problem

Keeping a finger on the pulse of the gaming vertical — viral leaks, controversial reviews, Reddit firestorms — currently means scrolling six outlet homepages and a handful of subs every morning. It eats the first hour of the day. There's no unified view of "what mattered in gaming in the last 24 hours, ranked by something other than vibes."

## Goal

Cut morning vertical-scan time from ~60 minutes to ~10. By the time a user opens the app each morning, they see a ranked list of the top external gaming stories from the last 24h, with a transparent reason each story ranked where it did, and a one-click way to mark each card handled.

## Users

1–5 internal users. Shared workspace, shared queue. No external users, no brand-specific personalization.

## Success Metrics

- Time-to-first-triage in the morning, before vs after launch
- **Triage-rate**: cards actioned (Posted / Skipped / Saved) ÷ cards shown per morning. Measurable from day 1 from in-app data
- Cards-shown-but-untouched after 2 mornings (this is what cross-morning dedup auto-suppresses; high values mean ranking is surfacing noise)
- User confidence: weekly self-report ("did the app save you time this week?")

## Core User Flow

1. User opens the app in the morning (browser)
2. Sees the top ~15 ranked gaming stories from the last 24h
3. Each card shows: source outlet/sub, headline, hero image (when available), publish time, and "why it ranked here" chips
4. User clicks the headline to read the source story in a new tab
5. User marks the card **Posted** (acted on this), **Skipped** (not relevant), or **Saved** (worth revisiting) — this drives cross-morning dedup and the learning loop
6. Skipped optionally takes a one-tap reason ("already covered," "wrong tone," "not gaming-relevant," "bad source")
7. A **Refresh** button in the header re-runs the ranking job against today's existing ranking snapshot. It re-fetches sources only if their cache is stale (RSS: 5 min TTL, Reddit: 15 min TTL — see Data Inputs), re-scores all candidates, and updates today's snapshot in place (no new historical row per click). 60s client-side cooldown so the button can't be spam-clicked. An admin-only `?force=1` query bypasses the cache TTL when debugging. Same flow supports a mid-day check-in.

**The "Posted" label is a triage marker, not a verified posting event.** It means "I've handled this card" — the user might have made a social post, kicked off an editorial brief, or just decided this is the story of the day. The app doesn't integrate with any posting tool.

## Data Inputs

**Job schedule** — ranking cron runs at **09:00 UTC daily** (~04:00 / 05:00 ET depending on DST). We commit to a fixed UTC time rather than tracking ET to keep Render Cron config trivial; the seasonal one-hour drift vs. ET is acceptable since the team reads the dashboard between 7am and 9am ET. Manual Refresh covers any edge case.

**Caches** — RSS responses cached 5 minutes (cheap, friendly to outlets); Reddit responses cached 15 minutes (per Reddit's API rule-of-thumb). The cron always reads through these caches; first hit of the day populates them and the morning's reads are cheap.

**Outlet RSS** — 5 outlets in week 1: IGN, Polygon, Kotaku, Eurogamer, PC Gamer. Pulled via `rss-parser`. Playwright fallback deferred to a later phase only if a feed proves unreliable.

**Reddit JSON** — public read-only endpoints (`/.json` suffix), no auth, no API key, custom `User-Agent` per Reddit's API rules. Endpoint: `/r/<sub>/top.json?t=day&limit=50` — `top?t=day` is the right choice for a once-a-morning cron over a 24h window (`hot` favors acceleration over absolute reach; `rising` is too volatile). **`limit=50` is a deliberate cap**: 7 subs × 50 = 350 daily candidates, which is more than enough to surface anything genuinely hot. By definition, a story that doesn't crack a sub's daily top-50 isn't carrying that sub.

Subs in scope:
- r/Games (curated news, best signal-to-noise)
- r/gaming (general, noisier but big)
- r/pcgaming, r/PS5, r/XboxSeriesX, r/NintendoSwitch (platform scoops)
- r/GamingLeaksAndRumours (viral early-signal source)

**Reddit plays two roles**; the ingestion pipeline must keep them separate:

1. **As an engagement signal for stories we already have.** If a Reddit post links out to a URL whose canonicalized form matches a story already ingested from outlet RSS, attach the Reddit thread (upvotes, comments, sub, permalink) to that existing story rather than creating a duplicate. The story keeps its outlet attribution and authority weight; Reddit data lifts its engagement term.
2. **As a story source on its own.** A Reddit post with no outbound link (self-post, image, or a link to a tweet/video) becomes its own story with source `reddit:<sub>` and authority `0.6`.

Merge key: lowercased canonical URL with tracking params stripped (`utm_*`, `fbclid`, `ref`, trailing slash). When outlet RSS provides a `<link rel="canonical">` we prefer that; otherwise the feed URL after strip.

**Google News RSS** — `news.google.com/rss/search?q=...` for trending gaming queries. Deferred to a later phase.

## Source Filters

Excluded at ingestion regardless of source:

- **Reddit posts removed/deleted by mod or author** by the time we read the JSON.
- **NSFW-flagged Reddit posts.**
- **Outlet RSS items older than 24h** at job time (some feeds backfill, we don't want yesterday's news re-ranked).

## Cross-Morning Dedup

A story's identity is its canonical URL (above). Across mornings:

- **Posted, Skipped, or Saved** in any prior run → suppressed from future rankings permanently.
- **Untouched** in a prior run but still inside the 24h window → re-shown, but with a `seen_before` flag in the card UI so the user knows it's not new. After 2 consecutive mornings untouched, auto-suppress (treated as implicit Skip).
- **Outside the 24h window** → naturally falls off.

Feedback rows persist forever; the suppression is a join, not a delete.

## Ranking

Heuristic, transparent, every term shows in the "why it ranked" line. Each term is normalized to `[0, 1]`; the final score lives in roughly `[0, 2]` (Reddit-less stories cap near 1.0). Term weights are configurable per-vertical without code changes.

```
score = w_authority * (recency_decay(published_at) * source_authority)
      + w_engagement * reddit_engagement_normalized
      + w_headline * llm_headline_score        // later phase

defaults: w_authority = 1.0, w_engagement = 1.0, w_headline = 0.5
```

**Source authority defaults** (editable in DB):

| Tier | Weight | Examples |
|---|---|---|
| Tier 1 | 1.0 | IGN, Polygon |
| Tier 2 | 0.9 | Kotaku, Eurogamer, PC Gamer |
| Tier 3 (blog/smaller) | 0.7 | Rock Paper Shotgun, Destructoid, VGC, Game Informer, others |
| Reddit-only (self-post or non-outlet link) | 0.6 | r/Games text post, r/GamingLeaksAndRumours screenshot |
| **Unseen domain** (default for any URL whose host doesn't match a seeded source) | **0.5** | First-time domains; promoted manually after review |

Unseen domains are logged on every cron run; an admin view shows the top unseen domains by frequency so we can promote them into a tier (or block them) within a few days of first sighting.

**Recency decay**: `exp(-hours_since_publish / 12)` — stories ~12h old score `~0.37` of fresh; stories at the 24h cutoff score `~0.14`. Combined with authority, this term lives in `[0, 1]`.

**Reddit engagement normalization**: `log10(upvotes + comments * 2)` divided by the 95th-percentile value over the last 7 days *per sub*, clipped to `[0, 1]`. Normalizing per-sub stops r/gaming's volume from drowning r/Games. Stories without any Reddit signal contribute 0 here — the ranking still works, they just lose one term.

**Cross-outlet topic dedup** (same news from IGN *and* Polygon): deferred to a later phase. Week 1 may show duplicates — user Skips with reason "already covered," which trains the dedup heuristic when it lands.

### "Why it ranked" — UI contract

The card UI shows the ranking explanation in human-readable form, **not** raw scores. Each contributing term becomes a chip:

**Ranking chips** (drive the score):
- Authority chip: `IGN · top-tier outlet` (when authority ≥ 0.9)
- Recency chip: `Published 3h ago` (always present, value computed at render)
- Reddit chip: `Hot on r/Games · 842↑ 312 comments` (only when a Reddit signal is attached; multi-sub stories show the strongest one)
- Headline chip (later phase): `Strong hook` / `Trending franchise: <name>` (only when LLM scoring runs)

**Metadata chips** (informational, don't affect score):
- `seen_before` chip: `Seen yesterday` (story was in a prior morning's ranking but untouched; see Cross-Morning Dedup). Visually muted so it doesn't compete with ranking chips.

**Dashboard banners** (page-level, not per-card):
- `Reddit unavailable` banner: shown when the morning's Reddit fetch failed for all subs. Wording: *"Reddit data unavailable this morning — rankings based on outlet + recency only. Refresh to retry."* The ranking still works (the Reddit term contributes 0) but the user needs to know one signal is missing rather than assume Reddit was quiet.

Raw scores are accessible via a "show math" toggle for power users / debugging, but are not the default presentation. A user who doesn't trust "0.73" trusts "842 upvotes in 6 hours."

## Auth

Magic-link login via Resend. No passwords, no SSO infra.

**Access control**: an allowlist of permitted email addresses, stored in DB (table `allowed_emails`). Magic-link requests for any address not on the list silently no-op (we don't leak whether an email is valid). Initial list is the 5 internal users + the developer; managed via a one-off admin script in week 1, replaced by a thin admin page if the team grows.

Sessions live in HMAC-signed cookies (same pattern as the existing converter apps under `Documents/`). No DB-backed session store.

## MVP Outputs

- Daily ranked story list (top 15) for the gaming vertical
- Per-story "why it ranked" explanation showing each scoring term as a chip
- Captured feedback (Posted / Skipped / Saved + skip reason) driving cross-morning dedup and the future learning loop

## Post-MVP (later phases)

- LLM headline scoring (clickability, social-fit, vertical relevance) added as a ranking term
- Google News RSS source
- Playwright scraper fallback for outlets that break RSS
- Cross-outlet topic clustering and dedup
- Feedback loop into ranking (the model learns per-user preferences from Posted/Skipped)
- Slack digest pushed to a shared channel at 6am ET
- Mobile-optimized view
- Multi-vertical support (additional verticals beyond gaming, each with its own source list)
- Per-source success-rate dashboard (cron health, broken feeds)

## Key Design Principles

- **Fast scan > deep dive.** Triage 15 cards in 2 minutes.
- **Explainable ranks.** Every score breaks out per-term so the user trusts and corrects it.
- **Feedback is the moat.** Capture Posted/Skipped/Saved from day one, even before the model uses it.
- **No LLM in MVP.** Heuristic-only ranking is good enough for week 1 and keeps cost + complexity near zero. LLM features are additive, not foundational.

## Decisions Logged

| Question | Decision |
|---|---|
| Pilot vertical | Gaming |
| Source CMS | None — scrape external outlets only |
| Analytics source | None on-site; Reddit engagement + source authority + (later) LLM judgment |
| Captions / brand voice | Dropped — internal users handle voice in their own tools |
| Posting tool integration | None — link out to source, user triages personally |
| Ranking scope | Already-published external stories from last 24h |
| Queue model | Shared per vertical |
| Source authority weights | Default tiers (1.0 / 0.9 / 0.7 / 0.6 / 0.5), editable in DB |
| LLM in MVP | None — heuristic only; LLM headline scoring is later phase |

## Phasing

- **Week 1** — Single vertical (gaming). 5 outlet RSS feeds + 7 Reddit subs. Heuristic ranking. Card UI with "why it ranked" chips and Posted/Skipped/Saved. Cross-morning dedup. Magic-link auth.
- **Week 2** — Polish. Unseen-domain admin view. Cron health monitoring. Skip-reason analytics.
- **Later** — LLM headline scoring. Google News RSS. Playwright fallback. Cross-outlet dedup. Feedback loop into ranking. Slack digest. Multi-vertical.

## Risks & Mitigations

- **RSS feeds break or get rate-limited** — start with 5 well-known outlets; monitor per-source success rate in the cron job; alert on >10% failure rate; have Playwright fallback ready for a later phase.
- **Reddit rate-limits public JSON** — cache responses for 15 min, identify with a custom User-Agent string per Reddit's API rules.
- **Trust erosion from bad ranks** — every score is broken out into its terms in the UI; Skip-reason data drives weekly tuning.
- **Team adoption** — 09:00 UTC cron lands rankings before the 7–9am ET morning read; bake into existing morning habits.
- **Legal/ToS** — only ingest public RSS and public Reddit JSON (no auth, no scraping behind paywalls). The app shows headlines + source attribution + a click-out, not reproduced article content.

## Out of Scope (explicit)

- Caption generation in any form
- Brand-voice tuning, voice CSVs, prompt templates
- Auto-posting to any platform
- Integration with internal posting / editorial tools
- Multi-vertical scaffolding before later phases
- Verifying that "Posted" actually resulted in a published social/editorial post
- Real-time push notifications
- Scheduling tool integrations (Buffer/Later/Sprout/Meta Business Suite)
