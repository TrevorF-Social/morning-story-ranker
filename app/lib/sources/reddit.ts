import { canonicalizeUrl } from "@/app/lib/canonical";

/**
 * Reddit JSON fetcher with a 15-minute in-process cache (PRD Data Inputs).
 *
 * Endpoint: /r/<sub>/top.json?t=day&limit=50 — committed in PRD as the
 * right pull for a once-a-morning cron over a 24h window.
 *
 * Each post is classified into one of two roles by the caller (in
 * ingest.ts):
 *   1. Outbound link to an outlet we already track → engagement signal
 *      attached to the existing story.
 *   2. Self-post, or outbound to a non-outlet (twitter, youtube, etc.) →
 *      standalone story with the reddit sub as its source.
 *
 * Filters applied here:
 *  - removed_by_category != null (mod/author removed by fetch time)
 *  - over_18 (NSFW)
 *  - stickied (announcements, megathreads — not news)
 *  - created_utc older than 24h
 *
 * Returns posts oldest-first stripped, ready for the ingest pass.
 */

export type RedditPost = {
  sourceId: number;          // sources.id for the sub
  subName: string;
  title: string;
  permalink: string;         // full reddit URL
  outboundUrl: string | null;        // null for self-posts and image hosts on i.redd.it
  outboundCanonical: string | null;  // canonicalized form for matching
  upvotes: number;
  comments: number;
  createdAt: Date;
  isSelf: boolean;
};

type RawListing = {
  data?: {
    children?: Array<{
      kind?: string;
      data?: RawPost;
    }>;
  };
};

type RawPost = {
  title?: string;
  permalink?: string;
  url?: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;       // seconds since epoch
  is_self?: boolean;
  over_18?: boolean;
  stickied?: boolean;
  removed_by_category?: string | null;
  selftext?: string;
  domain?: string;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const USER_AGENT =
  "MorningStoryRanker/0.1 (+internal newsroom tool; contact: admin@morningstoryranker.local)";

type CacheEntry = { fetchedAt: number; posts: RawPost[] };

declare global {
  // eslint-disable-next-line no-var
  var __redditCache: Map<string, CacheEntry> | undefined;
}
const cache: Map<string, CacheEntry> = global.__redditCache ?? (global.__redditCache = new Map());

async function fetchSubRaw(subName: string, opts: { force?: boolean } = {}): Promise<RawPost[]> {
  const now = Date.now();
  const cached = cache.get(subName);
  if (!opts.force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.posts;
  }

  const url = `https://www.reddit.com/r/${encodeURIComponent(subName)}/top.json?t=day&limit=50`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // 15s budget; Reddit usually responds in under 1s
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`reddit ${subName} HTTP ${res.status}`);
  }
  const body = (await res.json()) as RawListing;
  const posts = (body.data?.children ?? [])
    .filter((c) => c.kind === "t3" && c.data)
    .map((c) => c.data as RawPost);

  cache.set(subName, { fetchedAt: now, posts });
  return posts;
}

/**
 * Reddit hosts non-outbound content at i.redd.it / v.redd.it / reddit.com.
 * For these we treat the post as a self-post (no outbound URL match
 * possible). Outlets we DO track will have their canonical hosts seeded in
 * `sources` and match via canonicalHost in ingest.
 */
function isInternalRedditHost(host: string): boolean {
  return (
    host === "reddit.com" ||
    host === "old.reddit.com" ||
    host === "i.redd.it" ||
    host === "v.redd.it" ||
    host.endsWith(".redd.it")
  );
}

export type RedditSource = { id: number; subName: string };

export async function fetchRedditPosts(
  source: RedditSource,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ posts: RedditPost[]; error: string | null }> {
  const now = (opts.now ?? new Date()).getTime();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;

  let raw: RawPost[];
  try {
    raw = await fetchSubRaw(source.subName, { force: opts.force });
  } catch (err) {
    return { posts: [], error: err instanceof Error ? err.message : "reddit fetch failed" };
  }

  const out: RedditPost[] = [];
  for (const p of raw) {
    if (!p.title || !p.permalink) continue;
    if (p.removed_by_category != null) continue;
    if (p.over_18) continue;
    if (p.stickied) continue;
    const createdMs = (p.created_utc ?? 0) * 1000;
    if (!createdMs || createdMs < cutoff) continue;

    const rawOutbound = !p.is_self ? p.url?.trim() ?? null : null;
    let outboundUrl: string | null = null;
    let outboundCanonical: string | null = null;
    if (rawOutbound) {
      const canonical = canonicalizeUrl(rawOutbound);
      if (canonical) {
        try {
          const host = new URL(canonical).hostname;
          if (!isInternalRedditHost(host)) {
            outboundUrl = rawOutbound;
            outboundCanonical = canonical;
          }
        } catch {
          // ignore — fall through as no outbound
        }
      }
    }

    out.push({
      sourceId: source.id,
      subName: source.subName,
      title: p.title.trim(),
      permalink: `https://www.reddit.com${p.permalink}`,
      outboundUrl,
      outboundCanonical,
      upvotes: p.ups ?? 0,
      comments: p.num_comments ?? 0,
      createdAt: new Date(createdMs),
      isSelf: p.is_self === true || outboundUrl === null,
    });
  }

  return { posts: out, error: null };
}
