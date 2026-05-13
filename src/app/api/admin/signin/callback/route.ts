/**
 * Admin sign-in callback: receive Slack OIDC code, exchange for tokens,
 * fetch userInfo, verify email against AUTHORIZED_USER_EMAILS, set the
 * admin session cookie, redirect back to the original page.
 */

import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  buildSession,
  buildSessionCookie,
  verifySession,
} from "@/lib/admin-auth"
import { ADMIN_SIGNIN_STATE_COOKIE } from "@/lib/admin-signin-state"
import { getAuthorizedEmails } from "@/lib/permissions"

const SLACK_TOKEN_URL = "https://slack.com/api/openid.connect.token"
const SLACK_USERINFO_URL = "https://slack.com/api/openid.connect.userInfo"

function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  return raw.replace(/\/$/, "")
}

function signinErrorRedirect(error: string, returnTo?: string): NextResponse {
  const params = new URLSearchParams({ error })
  if (returnTo) params.set("returnTo", returnTo)
  return NextResponse.redirect(`${getAppUrl()}/admin/signin?${params.toString()}`)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  // 1. Validate the state cookie (nonce + returnTo)
  const jar = await cookies()
  const stateCookieValue = jar.get(ADMIN_SIGNIN_STATE_COOKIE)?.value
  const stateClaims = stateCookieValue ? verifySession(stateCookieValue) : null

  if (!stateClaims || !state || stateClaims.slackUserId !== state) {
    return signinErrorRedirect("invalid_state")
  }
  const returnTo = stateClaims.email || "/console"

  if (!code) {
    return signinErrorRedirect("oauth_failed", returnTo)
  }

  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return signinErrorRedirect("oauth_failed", returnTo)
  }

  // 2. Exchange code for tokens
  const redirectUri = `${getAppUrl()}/api/admin/signin/callback`
  let tokenData: {
    ok?: boolean
    error?: string
    access_token?: string
    id_token?: string
  }
  try {
    const tokenRes = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    })
    tokenData = await tokenRes.json()
  } catch (err) {
    console.error("[Admin Signin] Token exchange failed:", err)
    return signinErrorRedirect("oauth_failed", returnTo)
  }

  if (!tokenData.ok || !tokenData.access_token) {
    console.error("[Admin Signin] Token response:", tokenData)
    return signinErrorRedirect("oauth_failed", returnTo)
  }

  // 3. Fetch user info
  let userInfo: {
    ok?: boolean
    error?: string
    sub?: string
    "https://slack.com/user_id"?: string
    email?: string
    name?: string
  }
  try {
    const userRes = await fetch(SLACK_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    userInfo = await userRes.json()
  } catch (err) {
    console.error("[Admin Signin] UserInfo failed:", err)
    return signinErrorRedirect("oauth_failed", returnTo)
  }

  if (!userInfo.ok || !userInfo.email) {
    console.error("[Admin Signin] UserInfo response:", userInfo)
    return signinErrorRedirect("missing_email", returnTo)
  }

  const email = userInfo.email.toLowerCase()
  const allowed = getAuthorizedEmails().map((e) => e.toLowerCase())

  if (allowed.length === 0) {
    return signinErrorRedirect("not_configured", returnTo)
  }
  if (!allowed.includes(email)) {
    return signinErrorRedirect("unauthorized", returnTo)
  }

  // 4. Mint admin session cookie
  const slackUserId =
    userInfo["https://slack.com/user_id"] || userInfo.sub || email
  const session = buildSession({
    slackUserId,
    email,
    name: userInfo.name,
  })

  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/console"
  const res = NextResponse.redirect(`${getAppUrl()}${safeReturnTo}`)
  res.headers.append("Set-Cookie", buildSessionCookie(session))
  // Clear the short-lived state cookie
  res.cookies.set({
    name: ADMIN_SIGNIN_STATE_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  })
  return res
}
