import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkPassword, issueSessionCookie } from "@/app/lib/auth";
import { publicOrigin } from "@/app/lib/origin";

/**
 * POST /api/auth/login
 *
 * Accepts form-encoded {password, next?}. On match, issues the session
 * cookie and redirects to `next` (or "/"). On mismatch, redirects back to
 * /login?error=bad-password — we don't return a body so the form does a
 * normal page-load on submit.
 *
 * Open-redirect protection: `next` must start with "/" and not "//".
 */

const BodySchema = z.object({
  password: z.string().min(1).max(200),
  next: z.string().optional().default(""),
});

function safeNext(raw: string): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export async function POST(req: NextRequest) {
  const origin = publicOrigin(req);
  const form = await req.formData();
  const parsed = BodySchema.safeParse({
    password: form.get("password"),
    next: form.get("next") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login?error=bad-password", origin), { status: 303 });
  }

  const { password, next } = parsed.data;
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=bad-password", origin), { status: 303 });
  }

  const cookie = issueSessionCookie();
  const res = NextResponse.redirect(new URL(safeNext(next), origin), { status: 303 });
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
