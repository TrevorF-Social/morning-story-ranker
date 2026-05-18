"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh button. Posts to /api/refresh and revalidates the page.
 *
 * Server has the canonical 60s cooldown (see /api/refresh); the button just
 * matches it on the client so users don't pound it. Cooldown state lives
 * locally — not persisted across page loads.
 */

const CLIENT_COOLDOWN_MS = 60_000;

export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [lastClick, setLastClick] = useState<number | null>(null);
  const router = useRouter();

  const cooldownRemaining = lastClick ? Math.max(0, CLIENT_COOLDOWN_MS - (Date.now() - lastClick)) : 0;
  const inCooldown = cooldownRemaining > 0;

  function onClick() {
    if (inCooldown || pending) return;
    setLastClick(Date.now());
    startTransition(async () => {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) {
        console.error("refresh failed", await res.text());
      }
      router.refresh();
    });
  }

  const label = pending ? "Refreshing…" : inCooldown ? "Refresh (cooling down)" : "Refresh";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || inCooldown}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
