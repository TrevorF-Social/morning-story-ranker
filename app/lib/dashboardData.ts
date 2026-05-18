import { sql } from "@/app/lib/db";
import { latestRun } from "@/app/lib/runs";
import type { ScoreBreakdown } from "@/app/lib/ranking";

/**
 * Server-side fetch for the dashboard. Reads the latest snapshot for the
 * vertical (today's if cron has run; previous day's if it hasn't yet),
 * joined with story + source info and feedback state for the active user.
 */

export type DashboardCard = {
  rankingId: number;
  storyId: number;
  rank: number;
  title: string;
  url: string;
  heroImageUrl: string | null;
  publishedAt: string; // ISO
  source: {
    name: string;
    kind: "rss" | "reddit";
    subName: string | null;
    domain: string | null;
  };
  score: number;
  breakdown: ScoreBreakdown;
  seenBefore: boolean;
  userAction: "posted" | "skipped" | "saved" | null;
};

export type Dashboard = {
  snapshotDate: string;
  fetchedAt: string | null;       // when the snapshot was last computed
  cards: DashboardCard[];
  redditAllFailed: boolean;
  hasRun: boolean;
};

type RankingRow = {
  ranking_id: number;
  story_id: number;
  rank: number;
  score: string;
  score_breakdown: ScoreBreakdown;
  seen_before: boolean;
  snapshot_date: string;
  title: string;
  url: string;
  hero_image_url: string | null;
  published_at: Date;
  source_name: string;
  source_kind: "rss" | "reddit";
  source_sub_name: string | null;
  source_domain: string | null;
  user_action: "posted" | "skipped" | "saved" | null;
};

export async function loadDashboard(
  vertical: string,
  userEmail: string,
  opts: { limit?: number } = {},
): Promise<Dashboard> {
  const limit = opts.limit ?? 15;

  // Pull the most-recent snapshot date for this vertical. If none, return empty.
  const dateRows = await sql<{ snapshot_date: string }[]>`
    select max(snapshot_date)::text as snapshot_date
      from rankings
     where vertical = ${vertical}
  `;
  const snapshotDate = dateRows[0]?.snapshot_date ?? null;
  const run = await latestRun(vertical);

  if (!snapshotDate) {
    return {
      snapshotDate: "",
      fetchedAt: run?.startedAt.toISOString() ?? null,
      cards: [],
      redditAllFailed: false,
      hasRun: run != null,
    };
  }

  const rows = await sql<RankingRow[]>`
    select r.id as ranking_id,
           r.story_id, r.rank, r.score::text as score, r.score_breakdown, r.seen_before,
           r.snapshot_date::text as snapshot_date,
           s.title, s.url, s.hero_image_url, s.published_at,
           src.name as source_name,
           src.kind as source_kind,
           src.sub_name as source_sub_name,
           src.domain as source_domain,
           (
             select action
               from feedback f
              where f.story_id = r.story_id
                and f.user_email = ${userEmail.toLowerCase()}
              order by f.created_at desc
              limit 1
           ) as user_action
      from rankings r
      join stories s on s.id = r.story_id
      join sources src on src.id = s.source_id
     where r.snapshot_date = ${snapshotDate}::date
       and r.vertical = ${vertical}
     order by r.rank asc
     limit ${limit}
  `;

  const cards: DashboardCard[] = rows.map((row) => ({
    rankingId: row.ranking_id,
    storyId: row.story_id,
    rank: row.rank,
    title: row.title,
    url: row.url,
    heroImageUrl: row.hero_image_url,
    publishedAt: new Date(row.published_at).toISOString(),
    source: {
      name: row.source_name,
      kind: row.source_kind,
      subName: row.source_sub_name,
      domain: row.source_domain,
    },
    score: Number(row.score),
    breakdown: row.score_breakdown,
    seenBefore: row.seen_before,
    userAction: row.user_action,
  }));

  return {
    snapshotDate,
    fetchedAt: run?.startedAt.toISOString() ?? null,
    cards,
    redditAllFailed: run?.ingest.redditAllFailed ?? false,
    hasRun: run != null,
  };
}
