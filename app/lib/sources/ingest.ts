import { sql } from "@/app/lib/db";
import { canonicalizeUrl } from "@/app/lib/canonical";
import { fetchRssCandidates, type RssCandidate, type RssSource } from "@/app/lib/sources/rss";
import { fetchRedditPosts, type RedditPost, type RedditSource } from "@/app/lib/sources/reddit";

/**
 * Ingest orchestrator. Pulls every active source for a vertical, normalizes,
 * dedupes via canonical URL, and writes to `stories` + `story_signals`.
 *
 * Reddit's two-role behavior (PRD Data Inputs) lives here:
 *  - Reddit post whose outbound canonical host matches a seeded RSS outlet
 *    → ensure a story row exists for that outlet (insert from Reddit data if
 *    we don't have RSS for it yet), then attach the Reddit thread as a
 *    signal.
 *  - Reddit self-post / outbound to non-tracked host → standalone story
 *    with source = the reddit sub (authority 0.6 via the sub's seed row).
 *    Engagement still lands in story_signals so ranking can read it
 *    uniformly.
 *
 * Returns per-source success/failure so the cron can surface a "Reddit
 * unavailable" banner when every Reddit fetch fails.
 */

export type IngestReport = {
  vertical: string;
  fetchedAt: Date;
  rss: Array<{ sourceId: number; name: string; ok: boolean; candidates: number; error: string | null }>;
  reddit: Array<{ sourceId: number; subName: string; ok: boolean; posts: number; error: string | null }>;
  storiesUpserted: number;
  signalsAttached: number;
  redditAllFailed: boolean;
};

type SourceRow = {
  id: number;
  kind: "rss" | "reddit";
  name: string;
  feed_url: string | null;
  domain: string | null;
  sub_name: string | null;
  authority_weight: string; // numeric returns as string from postgres.js
};

export async function ingestVertical(
  vertical: string,
  opts: { force?: boolean; now?: Date } = {},
): Promise<IngestReport> {
  const fetchedAt = opts.now ?? new Date();

  const sources = await sql<SourceRow[]>`
    select id, kind, name, feed_url, domain, sub_name, authority_weight
      from sources
     where vertical = ${vertical} and active = true
  `;

  const rssSources: Array<RssSource & { name: string; domain: string | null }> = [];
  const redditSources: Array<RedditSource & { name: string }> = [];
  for (const s of sources) {
    if (s.kind === "rss" && s.feed_url) {
      rssSources.push({ id: s.id, feedUrl: s.feed_url, name: s.name, domain: s.domain });
    } else if (s.kind === "reddit" && s.sub_name) {
      redditSources.push({ id: s.id, subName: s.sub_name, name: s.name });
    }
  }

  // outletHostToSourceId: canonical host → RSS source id. Used to route
  // Reddit posts that link to a tracked outlet onto that outlet's story
  // (rather than creating a Reddit-only duplicate).
  const outletHostToSourceId = new Map<string, number>();
  for (const r of rssSources) {
    if (r.domain) outletHostToSourceId.set(r.domain.toLowerCase(), r.id);
  }

  // Fan out fetches.
  const rssResults = await Promise.all(
    rssSources.map((s) =>
      fetchRssCandidates({ id: s.id, feedUrl: s.feedUrl }, { force: opts.force, now: fetchedAt }),
    ),
  );
  const redditResults = await Promise.all(
    redditSources.map((s) =>
      fetchRedditPosts({ id: s.id, subName: s.subName }, { force: opts.force, now: fetchedAt }),
    ),
  );

  const report: IngestReport = {
    vertical,
    fetchedAt,
    rss: rssSources.map((s, i) => ({
      sourceId: s.id,
      name: s.name,
      ok: rssResults[i].error == null,
      candidates: rssResults[i].candidates.length,
      error: rssResults[i].error,
    })),
    reddit: redditSources.map((s, i) => ({
      sourceId: s.id,
      subName: s.subName,
      ok: redditResults[i].error == null,
      posts: redditResults[i].posts.length,
      error: redditResults[i].error,
    })),
    storiesUpserted: 0,
    signalsAttached: 0,
    redditAllFailed:
      redditSources.length > 0 && redditResults.every((r) => r.error != null),
  };

  // --- 1. Upsert RSS stories first so Reddit can match against them ---
  const rssCandidates = rssResults.flatMap((r) => r.candidates);
  const storyIdByCanonical = new Map<string, number>();
  for (const c of rssCandidates) {
    const id = await upsertStory(vertical, c);
    storyIdByCanonical.set(c.canonicalUrl, id);
  }
  report.storiesUpserted = storyIdByCanonical.size;

  // --- 2. Walk Reddit posts ---
  const redditPosts = redditResults.flatMap((r) => r.posts);
  for (const p of redditPosts) {
    // Case A: outbound matches a tracked outlet
    if (p.outboundCanonical) {
      let outletHost: string | null = null;
      try {
        outletHost = new URL(p.outboundCanonical).hostname;
      } catch {
        outletHost = null;
      }
      const outletSourceId = outletHost ? outletHostToSourceId.get(outletHost) ?? null : null;

      if (outletSourceId != null) {
        // Ensure a story row exists. If RSS already provided it, reuse the id;
        // otherwise insert a placeholder using Reddit's title + creation time.
        let storyId = storyIdByCanonical.get(p.outboundCanonical);
        if (storyId == null) {
          storyId = await upsertStory(vertical, {
            sourceId: outletSourceId,
            title: p.title,
            url: p.outboundUrl ?? p.outboundCanonical,
            canonicalUrl: p.outboundCanonical,
            publishedAt: p.createdAt,
            heroImageUrl: null,
            summary: null,
          });
          storyIdByCanonical.set(p.outboundCanonical, storyId);
          report.storiesUpserted++;
        }
        await upsertSignal(storyId, p);
        report.signalsAttached++;
        continue;
      }
    }

    // Case B: standalone story (self-post or non-tracked host)
    const canonical = p.outboundCanonical ?? canonicalizeUrl(p.permalink);
    if (!canonical) continue;
    let storyId = storyIdByCanonical.get(canonical);
    if (storyId == null) {
      storyId = await upsertStory(vertical, {
        sourceId: p.sourceId,
        title: p.title,
        url: p.outboundUrl ?? p.permalink,
        canonicalUrl: canonical,
        publishedAt: p.createdAt,
        heroImageUrl: null,
        summary: null,
      });
      storyIdByCanonical.set(canonical, storyId);
      report.storiesUpserted++;
    }
    await upsertSignal(storyId, p);
    report.signalsAttached++;
  }

  return report;
}

async function upsertStory(vertical: string, c: RssCandidate): Promise<number> {
  // ON CONFLICT DO UPDATE with a no-op assignment so we always get RETURNING.
  const rows = await sql<{ id: number }[]>`
    insert into stories (vertical, canonical_url, source_id, title, url, hero_image_url, summary, published_at)
    values (
      ${vertical},
      ${c.canonicalUrl},
      ${c.sourceId},
      ${c.title},
      ${c.url},
      ${c.heroImageUrl},
      ${c.summary},
      ${c.publishedAt}
    )
    on conflict (canonical_url) do update
       set canonical_url = stories.canonical_url
    returning id
  `;
  return rows[0].id;
}

async function upsertSignal(storyId: number, p: RedditPost): Promise<void> {
  await sql`
    insert into story_signals (story_id, kind, sub_name, upvotes, comments, reddit_permalink, fetched_at)
    values (${storyId}, 'reddit', ${p.subName}, ${p.upvotes}, ${p.comments}, ${p.permalink}, now())
    on conflict (story_id, sub_name) do update
       set upvotes = excluded.upvotes,
           comments = excluded.comments,
           reddit_permalink = excluded.reddit_permalink,
           fetched_at = excluded.fetched_at
  `;
}
