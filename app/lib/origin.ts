import type { NextRequest } from "next/server";

/**
 * Resolve the public origin to use when constructing redirect URLs.
 *
 * Render proxies requests to the internal port (10000), so `req.url` and
 * `req.nextUrl.origin` resolve to `http://localhost:10000`. Redirecting
 * relative to that yields broken `localhost:10000` URLs in the browser.
 *
 * Priority:
 *   1. PUBLIC_BASE_URL  — set this when you put a custom domain in front
 *   2. RENDER_EXTERNAL_URL — auto-injected by Render (e.g. https://*.onrender.com)
 *   3. req.nextUrl.origin — fine in local dev
 */
export function publicOrigin(req: NextRequest): string {
  return (
    process.env.PUBLIC_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    req.nextUrl.origin
  );
}
