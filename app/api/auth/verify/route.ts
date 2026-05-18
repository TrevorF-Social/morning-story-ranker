import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLinkToken, issueSessionCookie } from "@/app/lib/auth";

/**
 * GET /api/auth/verify?token=<raw>&next=<path>
 *
 * Single-use token consumption. On success: set the session cookie and
 * redirect to `next` (or "/" if absent). On failure: redirect to
 * /login?error=invalid-link.
 *
 * Open redirect protection: `next` must be a same-origin pathname starting
 * with "/" and not "//" (which would resolve as a protocol-relative URL).
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=invalid-link", req.url), { status: 303 });
  }

  const result = await consumeMagicLinkToken(token);
  if (!result) {
    return NextResponse.redirect(new URL("/login?error=invalid-link", req.url), { status: 303 });
  }

  const cookie = issueSessionCookie(result.email);
  const res = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  res.cookies.set({
    name: cookie.name,
    value: cookie.value,
    maxAge: cookie.maxAge,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res;
}
