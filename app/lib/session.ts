import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure HMAC-signed session cookies. No DB, no external deps — safe to import
 * from proxy.ts without pulling Postgres into the proxy bundle.
 *
 * Cookie format: `{base64url(payload)}.{hmac}` where payload is JSON `{iat}`.
 * Re-verified on every request; rotating AUTH_SECRET invalidates every
 * existing session.
 *
 * Shared-password auth: there's no per-user identity baked into the session.
 * Everyone on the team uses the same APP_PASSWORD. Upgrade path: re-introduce
 * an email/identity claim in the payload (and bring back magic-link or SSO).
 */

export const SESSION_COOKIE_NAME = "msr-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET env var is required (>=16 chars). Generate one: openssl rand -hex 32",
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function unb64url(s: string): Buffer {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

export function issueSessionCookie(): { name: string; value: string; maxAge: number } {
  const payload = b64url(Buffer.from(JSON.stringify({ iat: Date.now() })));
  const sig = sign(payload);
  return { name: SESSION_COOKIE_NAME, value: `${payload}.${sig}`, maxAge: SESSION_MAX_AGE_SECONDS };
}

export function clearSessionCookie(): { name: string; value: string; maxAge: number } {
  return { name: SESSION_COOKIE_NAME, value: "", maxAge: 0 };
}

export function verifySession(cookieValue: string | undefined | null): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = cookieValue.slice(0, dot);
  const sigGiven = cookieValue.slice(dot + 1);
  let sigExpected: string;
  try {
    sigExpected = sign(payload);
  } catch {
    return false;
  }
  const a = Buffer.from(sigGiven);
  const b = Buffer.from(sigExpected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  try {
    const decoded = JSON.parse(unb64url(payload).toString()) as { iat?: number };
    if (typeof decoded.iat !== "number") return false;
    if (Date.now() - decoded.iat > SESSION_MAX_AGE_SECONDS * 1000) return false;
    return true;
  } catch {
    return false;
  }
}
