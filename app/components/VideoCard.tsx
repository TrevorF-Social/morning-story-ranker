"use client";

import { useState, useTransition } from "react";
import type { DashboardCard } from "@/app/lib/dashboardData";

/**
 * Video card. Same shape as StoryCard but tuned for clips:
 *  - Play-icon overlay on the thumbnail
 *  - No authority chip (all videos are sourced via Reddit)
 *  - Engagement chip uses upvotes/comments; that's the primary signal
 */

type Action = "posted" | "skipped" | "saved";

const ACTION_LABELS: Record<Action, string> = {
  posted: "Posted",
  skipped: "Skipped",
  saved: "Saved",
};

const ACTION_TONES: Record<Action, string> = {
  posted: "bg-green-50 border-green-300 text-green-900",
  skipped: "bg-neutral-100 border-neutral-300 text-neutral-700",
  saved: "bg-amber-50 border-amber-300 text-amber-900",
};

export function VideoCard({ card }: { card: DashboardCard }) {
  const [action, setAction] = useState<Action | null>(card.userAction);
  const [pending, startTransition] = useTransition();

  function submit(newAction: Action) {
    const prev = action;
    setAction(newAction);
    startTransition(async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story_id: card.storyId, action: newAction }),
      });
      if (!res.ok) {
        setAction(prev);
        console.error("feedback failed", await res.text());
      }
    });
  }

  return (
    <article
      className={`flex gap-4 rounded-lg border bg-white p-4 transition ${
        action ? "opacity-60" : ""
      } border-neutral-200`}
    >
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative shrink-0 w-28 h-28 sm:w-36 sm:h-24 rounded-md overflow-hidden bg-neutral-900"
      >
        {card.heroImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={card.heroImageUrl}
            alt=""
            className="w-full h-full object-cover opacity-90"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs">
            no thumbnail
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/60 p-2">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-white"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </a>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
          <span className="font-medium">#{card.rank}</span>
          <span>·</span>
          <span>{card.source.name}</span>
        </div>
        <h2 className="text-base font-semibold leading-snug text-neutral-900">
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {card.title}
          </a>
        </h2>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {renderChips(card)}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(["posted", "skipped", "saved"] as Action[]).map((a) => (
            <button
              key={a}
              type="button"
              disabled={pending}
              onClick={() => submit(a)}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                action === a
                  ? ACTION_TONES[a]
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              } ${pending ? "cursor-wait" : ""}`}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function renderChips(card: DashboardCard): React.ReactNode[] {
  const chips: React.ReactNode[] = [];
  const b = card.breakdown;

  // Recency chip — always present.
  chips.push(<Chip key="rec" tone="neutral" label={formatRecency(b.hours_since_publish)} />);

  // Reddit engagement chip — videos always have one, so this is essentially mandatory.
  if (b.reddit) {
    chips.push(
      <Chip
        key="red"
        tone="warm"
        label={`r/${b.reddit.sub_name} · ${b.reddit.upvotes}↑ ${b.reddit.comments} comments`}
      />,
    );
  }

  if (card.seenBefore) {
    chips.push(<Chip key="seen" tone="muted" label="Seen previously" />);
  }

  return chips;
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "warm" | "neutral" | "muted";
}) {
  const toneClass = {
    warm: "bg-amber-100 text-amber-900 border border-amber-200",
    neutral: "bg-neutral-100 text-neutral-700 border border-neutral-200",
    muted: "bg-transparent text-neutral-400 border border-neutral-200 italic",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${toneClass}`}>
      {label}
    </span>
  );
}

function formatRecency(hours: number): string {
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `Posted ${mins}m ago`;
  }
  const h = Math.round(hours);
  return `Posted ${h}h ago`;
}
