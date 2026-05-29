import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/app/lib/session";
import { latestRun, runIngestAndRank } from "@/app/lib/runs";

/**
 * POST /api/refresh
 *
 * Session-gated refresh button. Re-runs ingest + rank for the vertical, but
 * cheaply: the source fetchers' caches (RSS 5min, Reddit 15min) absorb
 * back-to-back clicks. Admins can pass `?force=1` to bypass.
 *
 * 60-second cooldown enforced server-side, mirroring the client-side button
 * cooldown. If the latest run started less than 60s ago AND `force` isn't
 * set, return the existing report rather than re-running.
 */

const COOLDOWN_MS = 60_000;

export const dynamic = "force-dynamic";
// Reddit fetcher is now sequential with 2.5s spacing across ~20 subs → up
// to ~50s just for Reddit. Buffer to 120s so retries on 429 don't time out.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!verifySession(req.cookies.get(SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vertical = (req.nextUrl.searchParams.get("vertical") ?? "gaming").toLowerCase();
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (!force) {
    const last = await latestRun(vertical);
    if (last && Date.now() - last.startedAt.getTime() < COOLDOWN_MS) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "cooldown",
        lastStartedAt: last.startedAt.toISOString(),
      });
    }
  }

  try {
    const result = await runIngestAndRank(vertical, { triggeredBy: "refresh", force });
    return NextResponse.json({
      ok: true,
      vertical,
      startedAt: result.startedAt.toISOString(),
      durationMs: result.durationMs,
      ingest: result.ingest,
      ranking: result.ranking,
    });
  } catch (err) {
    console.error("refresh failed", err);
    return NextResponse.json(
      { ok: false, vertical, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
