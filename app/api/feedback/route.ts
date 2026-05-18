import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/app/lib/db";
import { SESSION_COOKIE_NAME, verifySession } from "@/app/lib/session";

/**
 * POST /api/feedback
 *
 * Records a Posted / Skipped / Saved click against a story. Session-gated by
 * the proxy; the session payload carries the email which we stamp on the row.
 *
 * Feedback rows are append-only — never updated, never deleted. The
 * cross-morning suppression in ranking.ts joins against this table; an undo
 * UI (if ever added) would write a counteracting row, not mutate existing.
 */

const BodySchema = z.object({
  story_id: z.coerce.number().int().positive(),
  action: z.enum(["posted", "skipped", "saved"]),
  reason: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  // Belt-and-braces session check — proxy already gated this route.
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySession(cookieValue);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Accept JSON or form-encoded.
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

  // Confirm the story exists. Cheaper than enforcing a FK error path.
  const exists = await sql<{ id: number }[]>`
    select id from stories where id = ${story_id} limit 1
  `;
  if (exists.length !== 1) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  await sql`
    insert into feedback (story_id, action, reason, user_email)
    values (${story_id}, ${action}, ${reason ?? null}, ${session.email})
  `;

  return NextResponse.json({ ok: true });
}
