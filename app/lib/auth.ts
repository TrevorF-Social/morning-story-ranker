import { timingSafeEqual } from "node:crypto";

// Re-export the session helpers so route handlers have one import.
// proxy.ts imports from "@/app/lib/session" directly.
export {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  issueSessionCookie,
  clearSessionCookie,
  verifySession,
} from "@/app/lib/session";

/**
 * Constant-time compare against APP_PASSWORD. Matches the converter apps'
 * pattern.
 */
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
