/**
 * Admin Session Auth
 *
 * Gates the admin pages (/console, /analytics, /audience-vocab) and their
 * APIs. Users sign in via Slack OAuth at /admin/signin; on success we set
 * an HMAC-signed cookie carrying their Slack user ID + email. Every
 * gated route calls `requireAdmin()` to check the cookie and confirm the
 * email is on `AUTHORIZED_USER_EMAILS`.
 *
 * Required env vars:
 *   MOPERATOR_SESSION_SECRET — 32-byte hex (openssl rand -hex 32)
 *   AUTHORIZED_USER_EMAILS — comma-separated allowlist
 */

import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"
import { getAuthorizedEmails } from "./permissions"

export const ADMIN_COOKIE_NAME = "moperator_admin"
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export interface AdminSession {
  slackUserId: string
  email: string
  name?: string
  expiresAt: number
}

function getSecret(): string {
  const raw = process.env.MOPERATOR_SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error(
      "MOPERATOR_SESSION_SECRET is required for admin auth. Generate: openssl rand -hex 32"
    )
  }
  return raw
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

export function signSession(session: AdminSession): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(session)))
  const sig = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest()
  )
  return `${body}.${sig}`
}

export function verifySession(raw: string): AdminSession | null {
  const dot = raw.indexOf(".")
  if (dot < 0) return null
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!body || !sig) return null

  const expected = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest()
  )
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  try {
    const session = JSON.parse(b64urlDecode(body).toString("utf8")) as AdminSession
    if (typeof session.expiresAt !== "number") return null
    if (Date.now() > session.expiresAt) return null
    if (!session.email || !session.slackUserId) return null
    return session
  } catch {
    return null
  }
}

export function buildSession(input: {
  slackUserId: string
  email: string
  name?: string
}): AdminSession {
  return {
    slackUserId: input.slackUserId,
    email: input.email,
    name: input.name,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
}

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public redirectTo: string,
    public code: "no_session" | "expired" | "not_authorized"
  ) {
    super(message)
    this.name = "AdminAuthError"
  }
}

/**
 * Require a valid admin session for the current request.
 *
 * Throws `AdminAuthError` on failure. In page components, catch it and
 * call `redirect(error.redirectTo)`. In API routes, return 401.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const jar = await cookies()
  const raw = jar.get(ADMIN_COOKIE_NAME)?.value
  if (!raw) {
    throw new AdminAuthError("Sign in required", "/admin/signin", "no_session")
  }
  const session = verifySession(raw)
  if (!session) {
    throw new AdminAuthError("Session expired", "/admin/signin", "expired")
  }
  const allowed = getAuthorizedEmails()
  if (allowed.length === 0) {
    // No allowlist configured at all — treat as locked down
    throw new AdminAuthError(
      "No admin emails configured",
      "/admin/signin?error=not_configured",
      "not_authorized"
    )
  }
  if (!allowed.includes(session.email.toLowerCase())) {
    throw new AdminAuthError(
      "Email not on admin allowlist",
      "/admin/signin?error=unauthorized",
      "not_authorized"
    )
  }
  return session
}

/**
 * Try to get the current admin session without throwing. Returns null
 * if not signed in or not authorized.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    return await requireAdmin()
  } catch {
    return null
  }
}

/**
 * Build the Set-Cookie header value for the admin session cookie.
 * Used in OAuth callback routes via NextResponse.cookies.set or
 * directly in a Response's `headers.append("Set-Cookie", ...)`.
 */
export function buildSessionCookie(session: AdminSession): string {
  const value = signSession(session)
  const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000)
  const parts = [
    `${ADMIN_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure")
  }
  return parts.join("; ")
}

export function buildClearSessionCookie(): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure")
  }
  return parts.join("; ")
}
