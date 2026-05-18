import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/app/lib/session";

/**
 * Auth gate. Anything not in the allowlist needs a valid session cookie or
 * gets bounced to /login?next=<originalPath>. API routes get JSON 401s.
 *
 * In Next.js 16 this file is named `proxy.ts` (was `middleware.ts` in ≤15)
 * and the exported function is `proxy()`.
 *
 * Imports session helpers from @/app/lib/session (pure HMAC, no DB) rather
 * than @/app/lib/auth so the proxy bundle stays lean for CDN deploys.
 */

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/magic-link",
  "/api/auth/verify",
  // Cron endpoint does its own bearer-token auth; don't redirect to /login.
  "/api/cron/rank",
]);

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith("/_next/")) return true;
  if (path === "/favicon.ico") return true;
  return false;
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySession(cookie);
  if (session) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  if (path !== "/") loginUrl.searchParams.set("next", path);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
