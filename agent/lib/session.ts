/**
 * Signed browser sessions, shared by the Next.js admin pages and the agent's
 * HTTP channel.
 *
 * People sign in with Slack at /admin/signin and get an HMAC-signed cookie
 * carrying their Slack user id and email. That one cookie now gates three
 * things: the admin pages, their APIs, and the agent itself at /chat — so the
 * browser chat needs no second login, and the identity it resolves is the same
 * email the approval policies check.
 *
 * Framework-agnostic on purpose: it works from a `Request` so `eveChannel`'s
 * auth walk can use it, with a thin `next/headers` wrapper in
 * `src/lib/admin-auth.ts` for server components.
 */

import { createHmac, timingSafeEqual } from "crypto"

export const SESSION_COOKIE_NAME = "moperator_admin"

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export interface MoperatorSession {
  slackUserId: string
  email: string
  name?: string
  expiresAt: number
}

function getSecret(): string {
  const raw = process.env.MOPERATOR_SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error(
      "MOPERATOR_SESSION_SECRET is required for browser sign-in. Generate one: openssl rand -hex 32"
    )
  }
  return raw
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function b64urlDecode(value: string): Buffer {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4))
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

export function signSession(session: MoperatorSession): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(session)))
  const signature = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest()
  )
  return `${body}.${signature}`
}

export function verifySession(raw: string): MoperatorSession | null {
  const dot = raw.indexOf(".")
  if (dot < 0) return null
  const body = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (!body || !signature) return null

  const expected = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest()
  )
  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length) return null
  if (!timingSafeEqual(given, want)) return null

  try {
    const session = JSON.parse(
      b64urlDecode(body).toString("utf8")
    ) as MoperatorSession
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
}): MoperatorSession {
  return { ...input, expiresAt: Date.now() + SESSION_TTL_MS }
}

/** Read and verify the session from a raw `Cookie` header. */
export function readSessionFromCookieHeader(
  header: string | null
): MoperatorSession | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== SESSION_COOKIE_NAME) continue
    try {
      return verifySession(decodeURIComponent(part.slice(eq + 1).trim()))
    } catch {
      return null
    }
  }
  return null
}

/** Read and verify the session from a `Request`. */
export function readSessionFromRequest(request: Request): MoperatorSession | null {
  return readSessionFromCookieHeader(request.headers.get("cookie"))
}

export function buildSessionCookie(session: MoperatorSession): string {
  const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000)
  const parts = [
    `${SESSION_COOKIE_NAME}=${signSession(session)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (process.env.NODE_ENV === "production") parts.push("Secure")
  return parts.join("; ")
}

export function buildClearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (process.env.NODE_ENV === "production") parts.push("Secure")
  return parts.join("; ")
}
