import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/app/lib/db";
import { SESSION_COOKIE_NAME, verifySession } from "@/app/lib/session";

/**
 * POST /api/feedback
 *
 * Records a Posted / Skipped / Saved click against a story. Session-gated by
 * the proxy; with shared-password auth there's no per-user identity, so we
 * stamp the row with user_email = NULL.
 *
 * Feedback rows are append-only — never updated, never deleted. The
 * cross-morning suppression in ranking.ts joins against this table.
 */

const BodySchema = z.object({
  story_id: z.coerce.number().int().positive(),
  action: z.enum(["posted", "skipped", "saved"]),
  reason: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  if (!verifySession(req.cookies.get(SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = await req.json().catch(() => null);
  } else {
    const form = await req.formData();
    body = Object.fromEntries(form.entries());
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { story_id, action, reason } = parsed.data;

  const exists = await sql<{ id: number }[]>`
    select id from stories where id = ${story_id} limit 1
  `;
  if (exists.length !== 1) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  await sql`
    insert into feedback (story_id, action, reason, user_email)
    values (${story_id}, ${action}, ${reason ?? null}, ${null})
  `;

  return NextResponse.json({ ok: true });
}
