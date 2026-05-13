/**
 * Per-user Salesforce OAuth — START.
 *
 * The Slack ephemeral message links the user here with `?nonce=<id>`. We:
 *   1. Validate the nonce exists (still in TTL window).
 *   2. Build the SFDC authorize URL with the same nonce as `state`.
 *   3. 302 the user to SFDC.
 *
 * SFDC redirects back to /api/integrations/salesforce/user-callback once
 * the user grants consent.
 */
import { NextRequest, NextResponse } from "next/server"
import {
  buildUserAuthorizationUrl,
  SFDC_USER_OAUTH_FEATURE_ENABLED,
} from "@/lib/integrations/salesforce/user-auth/connection"
import { peekOAuthState } from "@/lib/integrations/salesforce/user-auth/oauth-state"

function plainError(message: string, status = 400) {
  return new Response(
    `<html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;background:#000;color:#fff">
      <h1 style="color:#f44">Cannot start Salesforce OAuth</h1>
      <p>${message}</p>
      <p style="color:#888">Run <code>/moperator connect-sfdc</code> in Slack to start a fresh flow.</p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

export async function GET(req: NextRequest) {
  if (!SFDC_USER_OAUTH_FEATURE_ENABLED) {
    return plainError("Per-user Salesforce OAuth is not enabled on this instance. Set SFDC_USER_OAUTH_ENABLED=true in your environment.", 404)
  }

  const nonce = req.nextUrl.searchParams.get("nonce")
  if (!nonce) {
    return plainError("Missing nonce. Start a fresh flow from Slack.", 400)
  }

  const record = await peekOAuthState(nonce)
  if (!record) {
    return plainError("Connection link has expired (10-minute window). Run /moperator connect-sfdc again.", 410)
  }

  const authUrl = buildUserAuthorizationUrl(nonce, record.codeChallenge)
  return NextResponse.redirect(authUrl)
}
