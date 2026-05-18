import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure HMAC-signed session cookies. No DB, no external deps — safe to import
 * from proxy.ts without pulling Postgres/Resend into the proxy bundle.
 *
 * Cookie format: `{base64url(payload)}.{hmac}` where payload is JSON
 * `{email, iat}`. Re-verified on every request; rotating AUTH_SECRET
 * invalidates every existing session.
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

export type SessionPayload = { email: string; iat: number };

export function issueSessionCookie(email: string): {
  name: string;
  value: string;
  maxAge: number;
} {
  const payload = b64url(
    Buffer.from(JSON.stringify({ email: email.toLowerCase(), iat: Date.now() })),
  );
  const sig = sign(payload);
  return { name: SESSION_COOKIE_NAME, value: `${payload}.${sig}`, maxAge: SESSION_MAX_AGE_SECONDS };
}

export function clearSessionCookie(): { name: string; value: string; maxAge: number } {
  return { name: SESSION_COOKIE_NAME, value: "", maxAge: 0 };
}

export function verifySession(cookieValue: string | undefined | null): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = cookieValue.slice(0, dot);
  const sigGiven = cookieValue.slice(dot + 1);
  let sigExpected: string;
  try {
    sigExpected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sigGiven);
  const b = Buffer.from(sigExpected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(unb64url(payload).toString()) as Partial<SessionPayload>;
    if (typeof decoded.iat !== "number") return null;
    if (typeof decoded.email !== "string" || !decoded.email.includes("@")) return null;
    if (Date.now() - decoded.iat > SESSION_MAX_AGE_SECONDS * 1000) return null;
    return { email: decoded.email, iat: decoded.iat };
  } catch {
    return null;
  }
}
