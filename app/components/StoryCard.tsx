"use client";

import { useState, useTransition } from "react";
import type { DashboardCard } from "@/app/lib/dashboardData";

/**
 * Story card. Server component would suffice for rendering, but the action
 * buttons (Posted/Skipped/Saved) need optimistic state, so this is a client
 * component.
 *
 * Chips are formatted from the score breakdown, not raw numbers — per the
 * PRD's "Why it ranked — UI contract" section.
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

export function StoryCard({ card }: { card: DashboardCard }) {
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
        // Roll back optimistic state on failure.
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
      {card.heroImageUrl ? (
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 w-28 h-28 sm:w-32 sm:h-32 rounded-md overflow-hidden bg-neutral-100"
        >
          {/* Plain <img/> rather than next/image — we don't want to proxy
              every outlet's CDN through our origin for an internal tool. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.heroImageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="shrink-0 w-28 h-28 sm:w-32 sm:h-32 rounded-md bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">
          no image
        </div>
      )}

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

  // Authority chip — only show when authority is in tier 1 or 2 (>= 0.9).
  if (b.source_authority >= 0.9) {
    const label =
      b.source_authority >= 1
        ? `${b.source.name} · top-tier outlet`
        : `${b.source.name} · major outlet`;
    chips.push(<Chip key="auth" tone="strong" label={label} />);
  }

  // Recency chip — always present.
  chips.push(<Chip key="rec" tone="neutral" label={formatRecency(b.hours_since_publish)} />);

  // Reddit chip — only when a signal is attached.
  if (b.reddit) {
    chips.push(
      <Chip
        key="red"
        tone="warm"
        label={`Hot on r/${b.reddit.sub_name} · ${b.reddit.upvotes}↑ ${b.reddit.comments} comments`}
      />,
    );
  }

  // seen_before — metadata, muted.
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
  tone: "strong" | "warm" | "neutral" | "muted";
}) {
  const toneClass = {
    strong: "bg-neutral-900 text-white",
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
    return `Published ${mins}m ago`;
  }
  const h = Math.round(hours);
  return `Published ${h}h ago`;
}
