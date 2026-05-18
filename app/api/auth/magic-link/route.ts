import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLinkToken, isAllowedEmail } from "@/app/lib/auth";
import { sendMagicLinkEmail } from "@/app/lib/email";

const BodySchema = z.object({
  email: z.string().email().max(254),
  next: z.string().optional().default(""),
});

/**
 * POST /api/auth/magic-link
 *
 * Accepts form-encoded {email, next?}. Always redirects to /login?sent=1
 * regardless of whether the email is on the allowlist — we don't leak which
 * addresses are valid. The only path that doesn't redirect to ?sent=1 is a
 * failure to actually deliver the email (Resend down), which goes to
 * ?error=send-failed so the user knows to retry.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const parsed = BodySchema.safeParse({
    email: form.get("email"),
    next: form.get("next") ?? "",
  });

  // Bad input: silently send them back to the form. Don't reveal validation
  // failures — the form's `required` + `type=email` already covers UX.
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  }

  const { email, next } = parsed.data;
  const sentRedirect = NextResponse.redirect(new URL("/login?sent=1", req.url), { status: 303 });

  // Allowlist gate is silent — same redirect either way.
  if (!(await isAllowedEmail(email))) {
    return sentRedirect;
  }

  let token: { rawToken: string; expiresAt: Date };
  try {
    token = await createMagicLinkToken(email);
  } catch (err) {
    console.error("magic-link: createMagicLinkToken failed", err);
    return NextResponse.redirect(new URL("/login?error=send-failed", req.url), { status: 303 });
  }

  // Priority: explicit PUBLIC_BASE_URL → Render's auto-injected
  // RENDER_EXTERNAL_URL → request origin (works fine in local dev).
  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    req.nextUrl.origin;
  const verifyUrl = new URL("/api/auth/verify", baseUrl);
  verifyUrl.searchParams.set("token", token.rawToken);
  if (next) verifyUrl.searchParams.set("next", next);

  try {
    await sendMagicLinkEmail({
      to: email,
      url: verifyUrl.toString(),
      expiresAt: token.expiresAt,
    });
  } catch (err) {
    console.error("magic-link: send failed", err);
    return NextResponse.redirect(new URL("/login?error=send-failed", req.url), { status: 303 });
  }

  return sentRedirect;
}
