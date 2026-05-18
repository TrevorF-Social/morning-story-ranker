import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runIngestAndRank } from "@/app/lib/runs";

/**
 * POST /api/cron/rank
 *
 * The morning cron job. Token-authenticated via Authorization: Bearer header
 * against CRON_TOKEN env. Public from proxy's perspective (no session); the
 * route enforces its own auth.
 *
 * Runs ingestion + ranking for one vertical. Optional `?vertical=` query
 * param defaults to "gaming". Optional `?force=1` bypasses fetch caches.
 *
 * Returns a JSON report so Render Cron logs are useful for debugging.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.CRON_TOKEN;
  if (!expected || expected.length < 8) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const given = m[1];
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vertical = (req.nextUrl.searchParams.get("vertical") ?? "gaming").toLowerCase();
  const force = req.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await runIngestAndRank(vertical, { triggeredBy: "cron", force });
    return NextResponse.json({
      ok: true,
      vertical,
      startedAt: result.startedAt.toISOString(),
      durationMs: result.durationMs,
      ingest: result.ingest,
      ranking: result.ranking,
    });
  } catch (err) {
    console.error("cron/rank failed", err);
    return NextResponse.json(
      { ok: false, vertical, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export function GET() {
  return NextResponse.json(
    { error: "Use POST with Authorization: Bearer <CRON_TOKEN>" },
    { status: 405 },
  );
}
