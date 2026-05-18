import { Resend } from "resend";

/**
 * Thin wrapper around Resend for the magic-link email. Single sender, single
 * template. Keep dependencies minimal — if we end up sending more than one
 * kind of email, split into per-template modules.
 */

declare global {
  // eslint-disable-next-line no-var
  var __resend: Resend | undefined;
}

function client(): Resend {
  if (global.__resend) return global.__resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY env var is required to send magic-link emails.");
  }
  global.__resend = new Resend(key);
  return global.__resend;
}

function fromAddress(): string {
  const addr = process.env.MAIL_FROM;
  if (!addr) {
    throw new Error(
      'MAIL_FROM env var is required (e.g. "Morning Story Ranker <noreply@yourdomain.com>"). The domain must be verified in your Resend dashboard.',
    );
  }
  return addr;
}

export async function sendMagicLinkEmail(args: {
  to: string;
  url: string;
  expiresAt: Date;
}): Promise<void> {
  const { to, url, expiresAt } = args;
  const minutesLeft = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));

  const subject = "Your Morning Story Ranker sign-in link";
  const text = [
    "Click the link below to sign in to Morning Story Ranker.",
    "",
    url,
    "",
    `This link expires in ${minutesLeft} minutes and can only be used once.`,
    "If you didn't request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="margin: 0 0 16px;">Sign in to Morning Story Ranker</h2>
      <p style="margin: 0 0 24px; line-height: 1.5;">Click the button below to sign in. This link expires in ${minutesLeft} minutes and can only be used once.</p>
      <p style="margin: 0 0 24px;">
        <a href="${url}" style="display: inline-block; background: #111; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: 600;">Sign in</a>
      </p>
      <p style="margin: 0 0 8px; color: #555; font-size: 13px;">Or paste this URL into your browser:</p>
      <p style="margin: 0 0 24px; word-break: break-all; color: #555; font-size: 13px;">${url}</p>
      <p style="margin: 0; color: #888; font-size: 12px;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;

  const { error } = await client().emails.send({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });

  if (error) {
    // Surface as a plain Error so the route handler can log + return a generic
    // "if your email is on the allowlist, check your inbox" response without
    // leaking Resend internals.
    throw new Error(`Resend send failed: ${error.name ?? "unknown"} — ${error.message ?? ""}`);
  }
}
