import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/app/lib/db";

// Re-export the pure HMAC session helpers so route handlers have one import.
// proxy.ts imports from "@/app/lib/session" directly to avoid bundling the
// DB client into the proxy.
export {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  issueSessionCookie,
  clearSessionCookie,
  verifySession,
} from "@/app/lib/session";
export type { SessionPayload } from "@/app/lib/session";

const MAGIC_LINK_TTL_MINUTES = 15;

// ---------- Allowlist ----------

export async function isAllowedEmail(email: string): Promise<boolean> {
  const rows = await sql<{ email: string }[]>`
    select email from allowed_emails where email = ${email.toLowerCase()} limit 1
  `;
  return rows.length === 1;
}

// ---------- Magic links ----------

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Generate a single-use magic-link token for `email`, store its sha256 hash
 * in the DB, and return the raw token (to be embedded in the verify URL).
 *
 * Caller must check `isAllowedEmail(email)` first; this function does not
 * gate on the allowlist so it can be reused for inviting new users later.
 */
export async function createMagicLinkToken(email: string): Promise<{
  rawToken: string;
  expiresAt: Date;
}> {
  const rawToken = b64url(randomBytes(32));
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  await sql`
    insert into magic_link_tokens (email, token_hash, expires_at)
    values (${email.toLowerCase()}, ${tokenHash}, ${expiresAt})
  `;
  return { rawToken, expiresAt };
}

/**
 * Validate a raw magic-link token. On success, mark it used and return the
 * associated email. Returns null on bad/expired/already-used tokens.
 *
 * Single-use is enforced via an UPDATE … WHERE used_at IS NULL RETURNING
 * dance so concurrent verifies can't both succeed.
 */
export async function consumeMagicLinkToken(rawToken: string): Promise<{ email: string } | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const tokenHash = sha256Hex(rawToken);
  const rows = await sql<{ email: string }[]>`
    update magic_link_tokens
       set used_at = now()
     where token_hash = ${tokenHash}
       and used_at is null
       and expires_at > now()
    returning email
  `;
  if (rows.length !== 1) return null;
  return { email: rows[0].email };
}
