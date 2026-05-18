import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/app/lib/auth";

/**
 * POST /api/auth/logout — clear the session cookie, redirect to /login.
 *
 * Note: this route IS gated by the auth proxy (it's not in the public path
 * allowlist). Logged-out users hitting it just get bounced to /login anyway.
 */
export async function POST(req: NextRequest) {
  const cookie = clearSessionCookie();
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
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
