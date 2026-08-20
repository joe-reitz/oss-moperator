/**
 * The agent's HTTP channel — the routes the browser chat at /chat talks to,
 * and the surface `eve dev`, `eve invoke`, and `eve eval` drive.
 *
 * eve fails closed here: without an authenticator that accepts a request,
 * production traffic gets a 401. So the policy below is the one place that
 * decides who can reach the agent from a browser.
 *
 * It reuses the existing admin sign-in rather than inventing a second identity
 * system. Someone who signed in with Slack at /admin/signin and is on
 * AUTHORIZED_USER_EMAILS gets a **user** principal carrying their email — which
 * matters twice over: the approval policies read that email, and per-user
 * Salesforce OAuth can only bind a grant to a real user principal.
 */

import {
  ForbiddenError,
  localDev,
  vercelOidc,
  withAuthChallenges,
  type AuthFn,
} from "eve/channels/auth"
import { eveChannel } from "eve/channels/eve"

import { config } from "../lib/config"
import { authAttributes } from "../lib/identity"
import { readSessionFromRequest } from "../lib/session"

/**
 * Accept the signed admin session cookie.
 *
 * Returns `null` (skip to the next authenticator) when there is no cookie at
 * all, so an unauthenticated browser still gets eve's standard 401 rather than
 * a confusing 403. Throws `ForbiddenError` when someone *is* signed in but is
 * not on the allowlist, because that is a real answer they should see.
 */
function moperatorSession(): AuthFn<Request> {
  return withAuthChallenges(async (request) => {
    let session: ReturnType<typeof readSessionFromRequest>
    try {
      session = readSessionFromRequest(request)
    } catch {
      // MOPERATOR_SESSION_SECRET is unset or too short. Nothing to verify
      // against, so decline rather than throwing an opaque 500.
      return null
    }
    if (!session) return null

    if (!config.approvers.writes.includes(session.email.toLowerCase())) {
      throw new ForbiddenError({
        message: `${session.email} is not on AUTHORIZED_USER_EMAILS.`,
      })
    }

    return {
      authenticator: "app",
      principalId: session.slackUserId,
      principalType: "user",
      issuer: "moperator-admin",
      attributes: authAttributes({
        email: session.email,
        name: session.name,
        slackUserId: session.slackUserId,
        // Signing in through the admin allowlist means write approver by
        // definition; spend still needs the separate list.
        isWriteApprover: true,
        isSpendApprover: config.approvers.spend.includes(
          session.email.toLowerCase()
        ),
      }),
    }
  }, [{ scheme: "Bearer" }])
}

export default eveChannel({
  auth: [
    // Your own users first.
    moperatorSession(),
    // Lets the eve TUI, evals, and Vercel-to-Vercel callers (schedules,
    // subagents) reach the agent without a browser session.
    vercelOidc(),
    // Open on localhost for `eve dev` only; authenticates nothing in production.
    localDev(),
  ],
})
