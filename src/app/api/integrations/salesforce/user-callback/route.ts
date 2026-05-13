/**
 * Per-user Salesforce OAuth — CALLBACK.
 *
 * SFDC redirects here after the user grants consent. We:
 *   1. Validate `state` matches a stored OAuth-state nonce (single-use).
 *   2. Exchange `code` for refresh+access tokens (with PKCE verifier).
 *   3. Fetch the authenticated user's identity from SFDC.
 *   4. Store the encrypted refresh token keyed by the Slack user id from
 *      the original nonce — NOT from any value Slack-side sent through
 *      SFDC. This makes user-A-completing-user-B impossible.
 *   5. Post a confirmation back into the Slack channel.
 *   6. Render a "you can close this tab" page in the browser.
 */
import jsforce from "jsforce"
import { NextRequest } from "next/server"
import {
  getUserOAuth2,
  SFDC_USER_OAUTH_FEATURE_ENABLED,
} from "@/lib/integrations/salesforce/user-auth/connection"
import { consumeOAuthState } from "@/lib/integrations/salesforce/user-auth/oauth-state"
import { putUserSfdcToken } from "@/lib/integrations/salesforce/user-auth/store"

function htmlPage(opts: { title: string; body: string; ok: boolean }): Response {
  const accent = opts.ok ? "#4f4" : "#f44"
  return new Response(
    `<html><body style="font-family:system-ui;padding:40px;max-width:640px;margin:0 auto;background:#000;color:#fff">
      <h1 style="color:${accent}">${opts.title}</h1>
      ${opts.body}
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

async function postSlackConfirmation(args: {
  channelId: string
  threadTs?: string
  slackUserId: string
  sfdcUsername: string
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: args.channelId,
      thread_ts: args.threadTs,
      text: `<@${args.slackUserId}> connected Salesforce as \`${args.sfdcUsername}\` — actions you initiate via mOperator will now be attributed to you in Salesforce.`,
    }),
  }).catch((err) => {
    console.error("[SfdcUserCallback] Slack confirmation post failed:", err)
  })
}

export async function GET(req: NextRequest) {
  if (!SFDC_USER_OAUTH_FEATURE_ENABLED) {
    return htmlPage({
      ok: false,
      title: "Per-user OAuth not enabled",
      body: "<p>This instance does not have <code>SFDC_USER_OAUTH_ENABLED=true</code> set.</p>",
    })
  }

  const params = req.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const errorCode = params.get("error")
  const errorDescription = params.get("error_description")

  if (errorCode) {
    return htmlPage({
      ok: false,
      title: "Salesforce OAuth was cancelled or failed",
      body: `<p><strong>${errorCode}</strong>: ${errorDescription || "Unknown error"}</p>
             <p style="color:#888">Run <code>/moperator connect-sfdc</code> again to retry.</p>`,
    })
  }

  if (!code || !state) {
    return htmlPage({
      ok: false,
      title: "Missing OAuth parameters",
      body: `<p>Both <code>code</code> and <code>state</code> are required. Run <code>/moperator connect-sfdc</code> again.</p>`,
    })
  }

  const stateRecord = await consumeOAuthState(state)
  if (!stateRecord) {
    return htmlPage({
      ok: false,
      title: "Connection link expired",
      body: `<p>This OAuth link is invalid or already used. Run <code>/moperator connect-sfdc</code> again.</p>`,
    })
  }

  try {
    const oauth2 = getUserOAuth2()
    const conn = new jsforce.Connection({ oauth2 })
    await conn.authorize(code, { code_verifier: stateRecord.codeVerifier })

    const identity = await conn.identity()

    if (!conn.refreshToken) {
      throw new Error(
        "Salesforce did not return a refresh token. Make sure your Connected App allows the `refresh_token` and `offline_access` scopes."
      )
    }

    await putUserSfdcToken({
      slackUserId: stateRecord.slackUserId,
      sfdcUserId: identity.user_id,
      sfdcUsername: identity.username,
      instanceUrl: conn.instanceUrl!,
      refreshToken: conn.refreshToken,
    })

    await postSlackConfirmation({
      channelId: stateRecord.channelId,
      threadTs: stateRecord.threadTs,
      slackUserId: stateRecord.slackUserId,
      sfdcUsername: identity.username,
    })

    return htmlPage({
      ok: true,
      title: `Connected as ${identity.username}`,
      body: `<p>You can close this tab and return to Slack.</p>
             <p style="color:#888">Actions you initiate via mOperator will now be attributed to <code>${identity.username}</code> in Salesforce.</p>`,
    })
  } catch (err) {
    console.error("[SfdcUserCallback] Token exchange failed:", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return htmlPage({
      ok: false,
      title: "Token exchange failed",
      body: `<p>${message}</p>
             <p style="color:#888">Run <code>/moperator connect-sfdc</code> again to retry.</p>`,
    })
  }
}
