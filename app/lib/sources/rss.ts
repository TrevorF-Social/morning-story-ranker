import Parser from "rss-parser";
import { canonicalizeUrl } from "@/app/lib/canonical";

/**
 * RSS fetcher with a 5-minute in-process cache (PRD Data Inputs → Caches).
 * One parser instance per feed_url so custom fields don't conflict between
 * outlets.
 *
 * Returns candidates filtered to last 24h, oldest-first stripped. The cron
 * runs once a day so the cache is mostly cosmetic (the Refresh button is
 * where it actually pays off).
 */

export type RssCandidate = {
  sourceId: number;
  title: string;
  url: string;             // raw URL as found in the feed
  canonicalUrl: string;    // for dedup
  publishedAt: Date;
  heroImageUrl: string | null;
  summary: string | null;
};

type FeedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: { url?: string; type?: string };
  ["media:content"]?: { $?: { url?: string; medium?: string } };
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { fetchedAt: number; items: FeedItem[] };

declare global {
  // eslint-disable-next-line no-var
  var __rssCache: Map<string, CacheEntry> | undefined;
}
const cache: Map<string, CacheEntry> = global.__rssCache ?? (global.__rssCache = new Map());

const parser = new Parser<unknown, FeedItem>({
  timeout: 15_000,
  headers: {
    "User-Agent":
      "MorningStoryRanker/0.1 (+https://github.com/anthropics/morning-story-ranker; internal newsroom tool)",
  },
  customFields: {
    item: [["media:content", "media:content", { keepArray: false }]],
  },
});

async function fetchFeedItems(feedUrl: string, opts: { force?: boolean } = {}): Promise<FeedItem[]> {
  const now = Date.now();
  const cached = cache.get(feedUrl);
  if (!opts.force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.items;
  }
  const feed = await parser.parseURL(feedUrl);
  const items = (feed.items ?? []) as FeedItem[];
  cache.set(feedUrl, { fetchedAt: now, items });
  return items;
}

function pickHeroImage(item: FeedItem): string | null {
  const enclosure = item.enclosure?.url;
  if (enclosure && /^https?:/i.test(enclosure)) return enclosure;

  const media = item["media:content"]?.$?.url;
  if (media && /^https?:/i.test(media)) return media;

  // Last resort: first <img> in the content HTML
  const html = item.content ?? "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match && /^https?:/i.test(match[1])) return match[1];

  return null;
}

function pickPublishedAt(item: FeedItem): Date | null {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function pickSummary(item: FeedItem): string | null {
  const s = (item.contentSnippet ?? item.content ?? "").trim();
  if (!s) return null;
  // Trim to a sane length so DB rows stay small. Real summary text lands at
  // ranking-explanation time, not here.
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}

export type RssSource = { id: number; feedUrl: string };

export async function fetchRssCandidates(
  source: RssSource,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ candidates: RssCandidate[]; error: string | null }> {
  const now = (opts.now ?? new Date()).getTime();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;

  let items: FeedItem[];
  try {
    items = await fetchFeedItems(source.feedUrl, { force: opts.force });
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : "rss fetch failed",
    };
  }

  const out: RssCandidate[] = [];
  for (const item of items) {
    const link = item.link?.trim();
    const title = item.title?.trim();
    if (!link || !title) continue;
    const canonical = canonicalizeUrl(link);
    if (!canonical) continue;
    const publishedAt = pickPublishedAt(item);
    if (!publishedAt) continue;
    if (publishedAt.getTime() < cutoff) continue;

    out.push({
      sourceId: source.id,
      title,
      url: link,
      canonicalUrl: canonical,
      publishedAt,
      heroImageUrl: pickHeroImage(item),
      summary: pickSummary(item),
    });
  }

  return { candidates: out, error: null };
}
