import { canonicalizeUrl } from "@/app/lib/canonical";

/**
 * Reddit JSON fetcher with a 15-minute in-process cache (PRD Data Inputs).
 *
 * Endpoint: /r/<sub>/top.json?t=day&limit=50 — committed in PRD as the
 * right pull for a once-a-morning cron over a 24h window.
 *
 * Each post is classified into one of three roles by the caller (ingest.ts):
 *   1. Video post (is_video, or links to a known video host) → goes to the
 *      video-clips section of the dashboard (kind='video' on the story).
 *   2. Outbound link to a tracked outlet → engagement signal attached to the
 *      existing outlet story.
 *   3. Self-post / outbound to a non-outlet, non-video host → standalone
 *      news story with the reddit sub as source.
 *
 * Filters applied here:
 *  - removed_by_category != null (mod/author removed by fetch time)
 *  - over_18 (NSFW)
 *  - stickied (announcements, megathreads — not news)
 *  - created_utc older than 24h
 */

export type RedditPost = {
  sourceId: number;
  subName: string;
  title: string;
  permalink: string;
  outboundUrl: string | null;
  outboundCanonical: string | null;
  upvotes: number;
  comments: number;
  createdAt: Date;
  isSelf: boolean;

  // Video classification (populated when the post is detected as a clip)
  isVideo: boolean;
  // What we link to from the dashboard card. For Reddit-hosted videos this
  // is the comments permalink because Reddit's player handles the audio mux
  // — `media.reddit_video.fallback_url` is the silent DASH stream.
  videoUrl: string | null;
  // Stable dedup key. For Reddit-hosted videos this is the v.redd.it/{id}
  // base URL — same across crossposts. For external hosts it equals videoUrl.
  videoCanonical: string | null;
  videoHost: string | null;       // "youtube" | "twitch" | "streamable" | "v.redd.it" | "other"
  thumbnailUrl: string | null;
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
  created_utc?: number;
  is_self?: boolean;
  is_video?: boolean;
  over_18?: boolean;
  stickied?: boolean;
  removed_by_category?: string | null;
  selftext?: string;
  domain?: string;
  post_hint?: string;
  thumbnail?: string;
  preview?: {
    images?: Array<{
      source?: { url?: string };
    }>;
  };
  media?: {
    reddit_video?: { fallback_url?: string };
    oembed?: { thumbnail_url?: string; type?: string };
    type?: string;
  };
  secure_media?: {
    reddit_video?: { fallback_url?: string };
    oembed?: { thumbnail_url?: string; type?: string };
  };
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// Reddit's API guidelines say UAs must include a real contact identifier.
// The previous fake `admin@morningstoryranker.local` was probably one reason
// our requests were getting throttled aggressively.
const USER_AGENT =
  "MorningStoryRanker/0.2 (+https://github.com/TrevorF-Social/morning-story-ranker)";
const FETCH_TIMEOUT_MS = 15_000;
// Backoff schedule for 429 retries (ms). Two retries then give up.
const RETRY_DELAYS_MS = [3_000, 9_000];

// Hosts whose links we treat as video clips. Lower-cased, host-only.
const VIDEO_HOSTS = new Map<string, string>([
  ["youtube.com", "youtube"],
  ["m.youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["clips.twitch.tv", "twitch"],
  ["twitch.tv", "twitch"], // catches both /videos/ and /clips/
  ["www.twitch.tv", "twitch"],
  ["streamable.com", "streamable"],
  ["v.redd.it", "v.redd.it"],
  ["medal.tv", "medal"],
  ["kick.com", "kick"],
]);

type CacheEntry = { fetchedAt: number; posts: RawPost[] };

declare global {
  // eslint-disable-next-line no-var
  var __redditCache: Map<string, CacheEntry> | undefined;
}
const cache: Map<string, CacheEntry> = global.__redditCache ?? (global.__redditCache = new Map());

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSubRaw(subName: string, opts: { force?: boolean } = {}): Promise<RawPost[]> {
  const cached = cache.get(subName);
  if (!opts.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.posts;
  }

  const url = `https://www.reddit.com/r/${encodeURIComponent(subName)}/top.json?t=day&limit=50`;
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };

  // Up to 3 attempts: initial + 2 backoffs. Retries only on 429.
  // Non-429 errors (5xx, network) fail fast and the caller handles fallback.
  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as RawListing;
      const posts = (body.data?.children ?? [])
        .filter((c) => c.kind === "t3" && c.data)
        .map((c) => c.data as RawPost);
      cache.set(subName, { fetchedAt: Date.now(), posts });
      return posts;
    }
    lastStatus = res.status;
    // Drain body so the connection can be released
    try {
      await res.text();
    } catch {
      /* noop */
    }
    if (res.status !== 429) {
      throw new Error(`reddit ${subName} HTTP ${res.status}`);
    }
    // 429 → loop continues if more attempts remain
  }
  throw new Error(`reddit ${subName} HTTP ${lastStatus} (after retries)`);
}

function isInternalRedditHost(host: string): boolean {
  return (
    host === "reddit.com" ||
    host === "old.reddit.com" ||
    host === "i.redd.it" ||
    host === "v.redd.it" ||
    host.endsWith(".redd.it")
  );
}

/**
 * Decide whether a Reddit post is a video clip and pull out a stable URL +
 * thumbnail. Priority of signals:
 *
 *   1. is_video flag → v.redd.it native upload. Use media.reddit_video.fallback_url.
 *   2. post_hint = 'hosted:video' or 'rich:video' → confirms video kind.
 *   3. domain ∈ VIDEO_HOSTS → external video host. Use the post URL.
 *
 * If nothing matches, returns isVideo=false.
 */
function classifyVideo(
  p: RawPost,
  outboundCanonical: string | null,
): {
  isVideo: boolean;
  videoUrl: string | null;       // play target (what the user clicks)
  videoCanonical: string | null; // dedup key (same across crossposts)
  videoHost: string | null;
  thumbnailUrl: string | null;
} {
  const previewThumb = pickPreviewThumb(p);

  // 1. Reddit-hosted native video. fallback_url plays without sound
  // (DASH video-only stream — audio is a separate stream that only Reddit's
  // own player muxes). Link to the comments permalink so the user gets the
  // Reddit player and hears audio. Dedup via the v.redd.it base URL — same
  // across crossposts to multiple subs.
  if (p.is_video || p.post_hint === "hosted:video") {
    const permalinkUrl = `https://www.reddit.com${p.permalink ?? ""}`;
    const rawVRedditUrl = p.url ?? p.media?.reddit_video?.fallback_url ?? null;
    return {
      isVideo: true,
      videoUrl: permalinkUrl,
      videoCanonical: canonicalizeUrl(rawVRedditUrl) ?? canonicalizeUrl(permalinkUrl),
      videoHost: "v.redd.it",
      thumbnailUrl: previewThumb,
    };
  }

  // 2. External video host
  if (outboundCanonical) {
    let host: string | null = null;
    try {
      host = new URL(outboundCanonical).hostname;
    } catch {
      host = null;
    }
    if (host && VIDEO_HOSTS.has(host)) {
      const oembedThumb =
        p.media?.oembed?.thumbnail_url ?? p.secure_media?.oembed?.thumbnail_url ?? null;
      return {
        isVideo: true,
        videoUrl: outboundCanonical,
        videoCanonical: outboundCanonical,
        videoHost: VIDEO_HOSTS.get(host) ?? "other",
        thumbnailUrl: oembedThumb ?? previewThumb,
      };
    }
  }

  // 3. post_hint says rich:video but we couldn't find a host — still flag it
  if (p.post_hint === "rich:video" && outboundCanonical) {
    const oembedThumb =
      p.media?.oembed?.thumbnail_url ?? p.secure_media?.oembed?.thumbnail_url ?? null;
    return {
      isVideo: true,
      videoUrl: outboundCanonical,
      videoCanonical: outboundCanonical,
      videoHost: "other",
      thumbnailUrl: oembedThumb ?? previewThumb,
    };
  }

  return { isVideo: false, videoUrl: null, videoCanonical: null, videoHost: null, thumbnailUrl: null };
}

function pickPreviewThumb(p: RawPost): string | null {
  // preview.images[0].source.url is HTML-entity-encoded — decode &amp; → &
  const raw = p.preview?.images?.[0]?.source?.url;
  if (!raw) {
    // thumbnail fields can be "self"/"default"/"nsfw" — only accept URLs
    const t = p.thumbnail;
    if (t && /^https?:/i.test(t)) return t;
    return null;
  }
  return raw.replace(/&amp;/g, "&");
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

    // Outbound URL extraction (same logic as before)
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
          // ignore
        }
      }
    }

    const video = classifyVideo(p, outboundCanonical);

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
      isVideo: video.isVideo,
      videoUrl: video.videoUrl,
      videoCanonical: video.videoCanonical,
      videoHost: video.videoHost,
      thumbnailUrl: video.thumbnailUrl,
    });
  }

  return { posts: out, error: null };
}
