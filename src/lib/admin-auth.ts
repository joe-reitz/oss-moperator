/**
 * Admin session, Next.js side.
 *
 * A thin `next/headers` wrapper over `agent/lib/session.ts`, which owns the
 * actual signing and verification. They are the same session: the cookie that
 * gates /console, /analytics, and /audience-vocab is the cookie the agent's HTTP
 * channel authenticates for /chat, so signing in once covers both and the email
 * the approval policies check is the email that signed in.
 *
 * Required env vars:
 *   MOPERATOR_SESSION_SECRET — 32-byte hex (openssl rand -hex 32)
 *   AUTHORIZED_USER_EMAILS — comma-separated allowlist
 */

import { cookies } from "next/headers"

import { config } from "@agent/lib/config"
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  buildSession,
  buildSessionCookie,
  signSession,
  verifySession,
  type MoperatorSession,
} from "@agent/lib/session"

export {
  SESSION_COOKIE_NAME as ADMIN_COOKIE_NAME,
  buildClearSessionCookie,
  buildSession,
  buildSessionCookie,
  signSession,
  verifySession,
}

export type AdminSession = MoperatorSession

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
 * Throws `AdminAuthError` on failure. In page components, catch it and call
 * `redirect(error.redirectTo)`. In API routes, return 401.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const jar = await cookies()
  const raw = jar.get(SESSION_COOKIE_NAME)?.value
  if (!raw) {
    throw new AdminAuthError("Sign in required", "/admin/signin", "no_session")
  }

  const session = verifySession(raw)
  if (!session) {
    throw new AdminAuthError("Session expired", "/admin/signin", "expired")
  }

  const allowed = config.approvers.writes
  if (allowed.length === 0) {
    // No allowlist at all means locked down, not open.
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

/** Current admin session, or null when not signed in or not authorized. */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    return await requireAdmin()
  } catch {
    return null
  }
}
