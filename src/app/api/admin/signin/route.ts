/**
 * Admin sign-in start: redirect to Slack's Sign-in-with-Slack OAuth flow.
 *
 * Slack OIDC docs: https://api.slack.com/authentication/sign-in-with-slack
 */

import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { signSession, type AdminSession } from "@/lib/admin-auth"
import {
  ADMIN_SIGNIN_STATE_COOKIE,
  ADMIN_SIGNIN_STATE_TTL_MS,
} from "@/lib/admin-signin-state"

const SLACK_AUTHORIZE_URL = "https://slack.com/openid/connect/authorize"

// State claims piggyback on the AdminSession signing primitive.
// slackUserId holds the nonce; email holds the returnTo path.
type StateClaims = AdminSession

function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  return raw.replace(/\/$/, "")
}

export async function GET(request: Request) {
  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return new NextResponse(
      "SLACK_CLIENT_ID not set. See docs/security.md to enable admin sign-in.",
      { status: 500 }
    )
  }
  if (!process.env.MOPERATOR_SESSION_SECRET) {
    return new NextResponse(
      "MOPERATOR_SESSION_SECRET not set. Generate: openssl rand -hex 32",
      { status: 500 }
    )
  }

  const url = new URL(request.url)
  const returnTo = url.searchParams.get("returnTo") || "/console"
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/console"

  // Stash nonce + returnTo in a short-lived signed cookie. We reuse the
  // admin-session signing primitive for convenience.
  const nonce = randomBytes(16).toString("hex")
  const stateClaims: StateClaims = {
    slackUserId: nonce,
    email: safeReturnTo,
    expiresAt: Date.now() + ADMIN_SIGNIN_STATE_TTL_MS,
  }
  const stateCookie = signSession(stateClaims)

  const redirectUri = `${getAppUrl()}/api/admin/signin/callback`
  const authorize = new URL(SLACK_AUTHORIZE_URL)
  authorize.searchParams.set("client_id", clientId)
  authorize.searchParams.set("scope", "openid email profile")
  authorize.searchParams.set("redirect_uri", redirectUri)
  authorize.searchParams.set("state", nonce)
  authorize.searchParams.set("response_type", "code")

  const res = NextResponse.redirect(authorize.toString())
  res.cookies.set({
    name: ADMIN_SIGNIN_STATE_COOKIE,
    value: stateCookie,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SIGNIN_STATE_TTL_MS / 1000,
  })
  return res
}
