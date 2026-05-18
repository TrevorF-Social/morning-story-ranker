import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/app/lib/session";
import { runIngestAndRank } from "@/app/lib/runs";
import { latestRun } from "@/app/lib/runs";

/**
 * POST /api/refresh
 *
 * Session-gated refresh button. Re-runs ingest + rank for the vertical, but
 * cheaply: the source fetchers' caches (RSS 5min, Reddit 15min) absorb
 * back-to-back clicks. Admins can pass `?force=1` to bypass.
 *
 * Also enforces a 60-second cooldown server-side, mirroring the client-side
 * button cooldown. If the latest run started less than 60s ago AND `force`
 * isn't set, return the existing report rather than re-running.
 */

const COOLDOWN_MS = 60_000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
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
    const result = await runIngestAndRank(vertical, {
      triggeredBy: "refresh",
      userEmail: session.email,
      force,
    });
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
