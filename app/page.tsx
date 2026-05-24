import { loadDashboard } from "@/app/lib/dashboardData";
import { StoryCard } from "@/app/components/StoryCard";
import { VideoCard } from "@/app/components/VideoCard";
import { RefreshButton } from "@/app/components/RefreshButton";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // Two independent loads — news ranking and video clips ranking each have
  // their own per-kind rank order in the same `rankings` table.
  const [news, videos] = await Promise.all([
    loadDashboard("gaming", { kind: "news" }),
    loadDashboard("gaming", { kind: "video", limit: 15 }),
  ]);

  // Either load can surface the latest run; news is the primary signal.
  const fetchedAt = news.fetchedAt ?? videos.fetchedAt;
  const hasRun = news.hasRun || videos.hasRun;
  const redditAllFailed = news.redditAllFailed || videos.redditAllFailed;

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-neutral-900">Morning Story Ranker</h1>
            <p className="text-xs text-neutral-500">
              Gaming · last 24h
              {fetchedAt && (
                <>
                  {" · "}
                  Last refreshed {formatTimestamp(fetchedAt)}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RefreshButton />
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-8 space-y-10">
        {redditAllFailed && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Reddit data unavailable this morning — rankings based on outlet + recency only.
            Refresh to retry.
          </div>
        )}

        <SectionBlock
          title="News"
          subtitle="Top external stories from gaming outlets and Reddit"
          cards={news.cards}
          hasRun={hasRun}
          renderCard={(card) => <StoryCard key={card.rankingId} card={card} />}
        />

        <SectionBlock
          title="Video clips"
          subtitle="High-voted videos across gaming subreddits"
          cards={videos.cards}
          hasRun={hasRun}
          renderCard={(card) => <VideoCard key={card.rankingId} card={card} />}
        />
      </section>
    </main>
  );
}

function SectionBlock({
  title,
  subtitle,
  cards,
  hasRun,
  renderCard,
}: {
  title: string;
  subtitle: string;
  cards: Awaited<ReturnType<typeof loadDashboard>>["cards"];
  hasRun: boolean;
  renderCard: (card: (typeof cards)[number]) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">{title}</h2>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </div>
      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-900">
            {hasRun ? `Nothing matched the last 24h window in ${title.toLowerCase()}.` : "No rankings yet."}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {hasRun
              ? "Refresh to re-run, or wait for the 09:00 UTC cron."
              : "The 09:00 UTC cron will populate the dashboard. Click Refresh to run it now."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">{cards.map(renderCard)}</div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toUTCString();
}
