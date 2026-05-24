import { sql } from "@/app/lib/db";

/**
 * Heuristic ranker. Reads stories from the last 24h (with their signals),
 * applies the PRD formula, and upserts today's ranking snapshot.
 *
 * Score:
 *   score = w_authority * (recency_decay × source_authority)
 *         + w_engagement * reddit_engagement_normalized
 * Recency decay:   exp(-hours_since_publish / RECENCY_TAU_HOURS)
 * Reddit engagement: log10(upvotes + 2*comments) / p95(sub, last 7 days)
 *
 * Cross-morning dedup (PRD §Cross-Morning Dedup):
 *  - Story with any feedback row (Posted/Skipped/Saved) before today → suppressed
 *  - Story present in rankings on both T-1 and T-2 without feedback → suppressed
 *  - Otherwise included; `seen_before` flag set if story appeared in any prior ranking
 *
 * Output: rankings rows for ALL eligible stories (not just top 15) so the
 * audit trail is complete; UI does the top-N slice.
 */

const W_AUTHORITY = 1.0;
const W_ENGAGEMENT = 1.0;
const RECENCY_TAU_HOURS = 12;
const DEFAULT_P95 = Math.log10(50); // fallback when a sub has no 7-day history

export type RankReport = {
  vertical: string;
  snapshotDate: string;     // YYYY-MM-DD
  candidatesConsidered: number;
  ranksWritten: number;
  newsRanksWritten: number;
  videoRanksWritten: number;
  suppressedByFeedback: number;
  suppressedByTwoDay: number;
};

type StoryRow = {
  story_id: number;
  kind: "news" | "video";
  title: string;
  url: string;
  canonical_url: string;
  hero_image_url: string | null;
  summary: string | null;
  published_at: Date;
  source_id: number;
  source_name: string;
  source_kind: "rss" | "reddit";
  source_domain: string | null;
  source_sub_name: string | null;
  authority_weight: string;
};

type SignalRow = {
  story_id: number;
  sub_name: string;
  upvotes: number;
  comments: number;
};

type P95Row = { sub_name: string; p95: string | null };

export type ScoreBreakdown = {
  recency_decay: number;
  source_authority: number;
  authority_term: number;
  engagement_term: number;
  total: number;
  hours_since_publish: number;
  source: { id: number; name: string; kind: "rss" | "reddit"; sub_name: string | null };
  reddit?: {
    sub_name: string;
    upvotes: number;
    comments: number;
    normalized: number;
    p95_used: number;
  };
};

/** UTC date in YYYY-MM-DD for use as snapshot_date. */
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function rankVertical(
  vertical: string,
  opts: { now?: Date } = {},
): Promise<RankReport> {
  const now = opts.now ?? new Date();
  const snapshotDate = utcDateString(now);
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // --- 1. Per-sub p95 over last 7 days ---
  const p95Rows = await sql<P95Row[]>`
    select sub_name,
           percentile_cont(0.95) within group (
             order by log(greatest(upvotes + 2 * comments, 1))
           )::text as p95
      from story_signals
     where kind = 'reddit'
       and fetched_at > now() - interval '7 days'
     group by sub_name
  `;
  const p95BySub = new Map<string, number>();
  for (const r of p95Rows) {
    const v = r.p95 ? Number(r.p95) : NaN;
    if (Number.isFinite(v) && v > 0) p95BySub.set(r.sub_name, v);
  }

  // --- 2. Load candidate stories (last 24h, this vertical) ---
  const stories = await sql<StoryRow[]>`
    select s.id as story_id, s.kind,
           s.title, s.url, s.canonical_url, s.hero_image_url, s.summary, s.published_at,
           src.id as source_id,
           src.name as source_name,
           src.kind as source_kind,
           src.domain as source_domain,
           src.sub_name as source_sub_name,
           src.authority_weight
      from stories s
      join sources src on src.id = s.source_id
     where s.vertical = ${vertical}
       and s.published_at > ${cutoff}
  `;

  if (stories.length === 0) {
    return {
      vertical,
      snapshotDate,
      candidatesConsidered: 0,
      ranksWritten: 0,
      newsRanksWritten: 0,
      videoRanksWritten: 0,
      suppressedByFeedback: 0,
      suppressedByTwoDay: 0,
    };
  }

  const storyIds = stories.map((s) => s.story_id);

  // --- 3. Load signals for these stories ---
  const signals = await sql<SignalRow[]>`
    select story_id, sub_name, upvotes, comments
      from story_signals
     where story_id in ${sql(storyIds)}
       and kind = 'reddit'
  `;
  const signalsByStory = new Map<number, SignalRow[]>();
  for (const sig of signals) {
    const arr = signalsByStory.get(sig.story_id) ?? [];
    arr.push(sig);
    signalsByStory.set(sig.story_id, arr);
  }

  // --- 4. Load suppression sets ---
  // 4a. Stories with feedback before today
  const fedRows = await sql<{ story_id: number }[]>`
    select distinct story_id
      from feedback
     where created_at < ${snapshotDate}::date
       and story_id in ${sql(storyIds)}
  `;
  const suppressedByFeedback = new Set(fedRows.map((r) => r.story_id));

  // 4b. Stories present in rankings on T-1 AND T-2 without any feedback
  const twoDayRows = await sql<{ story_id: number }[]>`
    select r1.story_id
      from rankings r1
      join rankings r2 on r2.story_id = r1.story_id
     where r1.snapshot_date = (${snapshotDate}::date - 1)
       and r2.snapshot_date = (${snapshotDate}::date - 2)
       and r1.vertical = ${vertical}
       and r2.vertical = ${vertical}
       and r1.story_id in ${sql(storyIds)}
       and not exists (
         select 1 from feedback f where f.story_id = r1.story_id
       )
  `;
  const suppressedByTwoDay = new Set(twoDayRows.map((r) => r.story_id));

  // 4c. seen_before: appeared in any prior ranking (for the UI chip)
  const priorRankRows = await sql<{ story_id: number }[]>`
    select distinct story_id
      from rankings
     where snapshot_date < ${snapshotDate}::date
       and vertical = ${vertical}
       and story_id in ${sql(storyIds)}
  `;
  const seenBeforeSet = new Set(priorRankRows.map((r) => r.story_id));

  // --- 5. Score the eligible stories ---
  type Scored = {
    storyId: number;
    kind: "news" | "video";
    score: number;
    breakdown: ScoreBreakdown;
    seenBefore: boolean;
  };
  const scored: Scored[] = [];

  for (const s of stories) {
    if (suppressedByFeedback.has(s.story_id)) continue;
    if (suppressedByTwoDay.has(s.story_id)) continue;

    const hoursSince = Math.max(
      0,
      (now.getTime() - new Date(s.published_at).getTime()) / 3_600_000,
    );
    const recencyDecay = Math.exp(-hoursSince / RECENCY_TAU_HOURS);
    const authority = Number(s.authority_weight);
    const authorityTerm = recencyDecay * authority;

    // Pick the strongest signal (max normalized engagement across subs)
    let engagementTerm = 0;
    let bestSignal: ScoreBreakdown["reddit"] | undefined;
    const sigs = signalsByStory.get(s.story_id) ?? [];
    for (const sig of sigs) {
      const raw = Math.log10(Math.max(sig.upvotes + 2 * sig.comments, 1));
      const p95 = p95BySub.get(sig.sub_name) ?? DEFAULT_P95;
      const normalized = Math.min(1, raw / p95);
      if (normalized > engagementTerm) {
        engagementTerm = normalized;
        bestSignal = {
          sub_name: sig.sub_name,
          upvotes: sig.upvotes,
          comments: sig.comments,
          normalized,
          p95_used: p95,
        };
      }
    }

    const total = W_AUTHORITY * authorityTerm + W_ENGAGEMENT * engagementTerm;

    scored.push({
      storyId: s.story_id,
      kind: s.kind,
      score: total,
      seenBefore: seenBeforeSet.has(s.story_id),
      breakdown: {
        recency_decay: round4(recencyDecay),
        source_authority: round4(authority),
        authority_term: round4(authorityTerm),
        engagement_term: round4(engagementTerm),
        total: round4(total),
        hours_since_publish: round2(hoursSince),
        source: {
          id: s.source_id,
          name: s.source_name,
          kind: s.source_kind,
          sub_name: s.source_sub_name,
        },
        ...(bestSignal ? { reddit: bestSignal } : {}),
      },
    });
  }

  // Sort + assign rank PER KIND so each section has its own 1..N. A 'news'
  // story and a 'video' story can both have rank=1 in the rankings table;
  // uniqueness is still (snapshot_date, vertical, story_id).
  scored.sort((a, b) => b.score - a.score);
  const ranksByKind = new Map<"news" | "video", number>();
  const ranked = scored.map((s) => {
    const next = (ranksByKind.get(s.kind) ?? 0) + 1;
    ranksByKind.set(s.kind, next);
    return { ...s, rank: next };
  });

  // --- 6. Wipe + rewrite today's snapshot in a single transaction ---
  // Refresh updates in place; the cleanest way to handle re-runs is to delete
  // today's rows for this vertical and reinsert with fresh ranks. Feedback
  // rows reference stories (not rankings), so this doesn't lose any state.
  await sql.begin(async (tx) => {
    await tx`
      delete from rankings
       where snapshot_date = ${snapshotDate}::date
         and vertical = ${vertical}
    `;
    for (const s of ranked) {
      await tx`
        insert into rankings (snapshot_date, vertical, story_id, score, score_breakdown, rank, seen_before, updated_at)
        values (
          ${snapshotDate}::date,
          ${vertical},
          ${s.storyId},
          ${s.score},
          ${tx.json(s.breakdown)},
          ${s.rank},
          ${s.seenBefore},
          now()
        )
      `;
    }
  });

  return {
    vertical,
    snapshotDate,
    candidatesConsidered: stories.length,
    ranksWritten: ranked.length,
    newsRanksWritten: ranksByKind.get("news") ?? 0,
    videoRanksWritten: ranksByKind.get("video") ?? 0,
    suppressedByFeedback: suppressedByFeedback.size,
    suppressedByTwoDay: suppressedByTwoDay.size,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
