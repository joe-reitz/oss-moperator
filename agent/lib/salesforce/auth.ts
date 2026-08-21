/**
 * Per-user Salesforce identity.
 *
 * The reason this exists is the audit trail, and it is worth being precise
 * about why it is built this way rather than as a log of our own.
 *
 * Salesforce already has a first-class audit trail: `CreatedById`,
 * `LastModifiedById`, Field History Tracking with before and after values per
 * field, and the Setup Audit Trail. It is authoritative, queryable with SOQL,
 * retained under the org's policy, and already inside whatever compliance
 * regime the company runs. Anything this repo logged alongside it would be a
 * worse copy that nobody trusts.
 *
 * The one thing that makes Salesforce's trail useless for an agent is a shared
 * service account. If every change the agent makes says "mOperator Integration
 * User", the trail records that a bot did everything and answers no question
 * anyone actually asks.
 *
 * So: each person's writes carry their own Salesforce identity, and **if that
 * cannot happen, the write does not happen**. There is no silent fallback. A
 * quiet downgrade to the service account is worse than an error, because it
 * produces exactly the audit trail you believe you have and do not.
 *
 * eve owns the sign-in flow — it mints the callback URL, parks the turn durably
 * at the prompt, resumes where it stopped, and renders the challenge natively
 * per channel. We own persistence: refresh tokens live encrypted in
 * `./token-store.ts`, keyed by email so one person has one grant across Slack
 * and the browser.
 *
 * Attribution follows the **requester**, not the approver. When a write parks
 * for approval and someone else clicks Approve, eve makes the approver the
 * turn's current caller — but the person who asked for the change is the one
 * Salesforce should name. The approval itself is recorded in the Slack thread,
 * which is durable and searchable.
 */

import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  defineInteractiveAuthorization,
} from "eve/connections"
import type { ToolContext } from "eve/tools"

import { config } from "../config"
import { getLoginUrl, type SfdcCredentials } from "./client"
import { getGrant, putGrant, tokenStoreAvailable, touchGrant } from "./token-store"

/** REST API access plus a refresh token, so a person signs in once. */
const SCOPES = "api refresh_token offline_access"

/** OAuth errors where re-prompting cannot help. */
const TERMINAL_ERRORS = ["invalid_grant", "access_denied", "expired authorization"]

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  instance_url?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      "Per-user Salesforce identity needs SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET."
    )
  }
  return { clientId, clientSecret }
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${getLoginUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  })
  return (await response.json()) as TokenResponse
}

function failAuthorization(error: string, description?: string): never {
  const detail = (description || error).toLowerCase()
  throw new ConnectionAuthorizationFailedError("salesforce", {
    reason: error,
    // Someone who clicked Deny should not be asked again in a loop.
    retryable: !TERMINAL_ERRORS.some((needle) => detail.includes(needle)),
  })
}

/** Exchange a stored refresh token for a usable access token. */
async function accessTokenFor(
  email: string
): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const grant = await getGrant(email)
  if (!grant) return null

  const { clientId, clientSecret } = clientCredentials()
  const data = await postToken({
    grant_type: "refresh_token",
    refresh_token: grant.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  // Revoked or expired in Salesforce. Treat as not connected so the person is
  // asked to sign in again rather than being handed a dead token.
  if (data.error || !data.access_token) return null

  void touchGrant(email)
  return {
    accessToken: data.access_token,
    instanceUrl: grant.instanceUrl || process.env.SALESFORCE_INSTANCE_URL || "",
  }
}

/**
 * The interactive provider eve drives when the current caller needs to sign in.
 *
 * `getToken` is probed before every gated call and throws `Required` when there
 * is no grant, which is what starts the browser flow and parks the turn.
 */
export const salesforceUserAuth = defineInteractiveAuthorization<{
  email: string
}>({
  displayName: "Salesforce",

  async getToken({ principal }) {
    // Interactive auth pins principalType to "user", so a grant is always keyed
    // to a person. Attributes carry the email we key grants by.
    const email =
      principal.type === "user"
        ? (principal.attributes?.email as string | undefined)
        : undefined
    if (!email) throw new ConnectionAuthorizationRequiredError("salesforce")

    const resolved = await accessTokenFor(email)
    if (!resolved) throw new ConnectionAuthorizationRequiredError("salesforce")

    return {
      token: resolved.accessToken,
      // Salesforce access tokens are session-lifetime; refresh a little early.
      expiresAt: Date.now() + 3_600_000 - 60_000,
    }
  },

  async startAuthorization({ callbackUrl }) {
    const { clientId } = clientCredentials()

    const url = new URL(`${getLoginUrl()}/services/oauth2/authorize`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", callbackUrl)
    url.searchParams.set("scope", SCOPES)
    // Always show the account chooser: someone signing in from Slack should not
    // silently reuse whichever Salesforce org their browser happened to have.
    url.searchParams.set("prompt", "login consent")

    return {
      challenge: {
        url: url.toString(),
        displayName: "Salesforce",
        instructions:
          "Sign in to Salesforce so this change is recorded under your name.",
      },
    }
  },

  async completeAuthorization({ principal, callbackUrl, callback }) {
    const code = callback.params.code
    if (!code) {
      failAuthorization(
        callback.params.error ?? "missing_code",
        callback.params.error_description
      )
    }

    const { clientId, clientSecret } = clientCredentials()
    const data = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
    })

    if (data.error || !data.access_token) {
      failAuthorization(data.error ?? "token_exchange_failed", data.error_description)
    }

    const email =
      principal.type === "user"
        ? (principal.attributes?.email as string | undefined)
        : undefined
    const instanceUrl = data.instance_url || process.env.SALESFORCE_INSTANCE_URL || ""

    // Persist so later turns and later days do not re-prompt. Without a refresh
    // token Salesforce gave us a session-only grant — still usable right now.
    if (data.refresh_token && email) {
      await putGrant({ email, instanceUrl, refreshToken: data.refresh_token })
    }

    return { token: data.access_token! }
  },
})

// ─── Resolution ──────────────────────────────────────────────────────────────

/** What identity a call should run under. `refused` never falls back. */
export type SfdcIdentity =
  | { kind: "user"; credentials: SfdcCredentials; email: string }
  | { kind: "service" }
  | { kind: "refused"; reason: string }

function emailOf(principal: { attributes?: unknown } | null | undefined): string | undefined {
  const attributes = principal?.attributes as { email?: string } | undefined
  const email = attributes?.email
  return email && email.length > 0 ? email.toLowerCase() : undefined
}

function isAppPrincipal(principal: {
  authenticator?: string
  principalType?: string
} | null | undefined): boolean {
  return principal?.principalType === "runtime" || principal?.authenticator === "app-runtime"
}

/**
 * Are the pieces for per-user identity actually in place? Missing setup is a
 * deployment error, not a reason to quietly write as the service account.
 */
function setupProblem(): string | null {
  if (!process.env.SALESFORCE_CLIENT_ID || !process.env.SALESFORCE_CLIENT_SECRET) {
    return "SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are not set"
  }
  if (!tokenStoreAvailable()) {
    return "Redis (UPSTASH_REDIS_REST_URL/_TOKEN) and MOPERATOR_TOKEN_ENCRYPTION_KEY are needed to store per-user grants"
  }
  if (!process.env.SALESFORCE_INSTANCE_URL) {
    return "SALESFORCE_INSTANCE_URL is not set"
  }
  return null
}

/**
 * Identity for a **read**. Reads carry no attribution value, so by default they
 * use the service account and nobody has to sign in to ask a question.
 *
 * Under `user-all` they use the caller's identity instead, which means
 * Salesforce's sharing rules and field-level security apply per person — the
 * agent cannot surface a record someone could not open themselves.
 */
export async function resolveSfdcRead(ctx: ToolContext): Promise<SfdcIdentity> {
  if (config.salesforce.identity !== "user-all") return { kind: "service" }
  return resolveUserIdentity(ctx, "read")
}

/**
 * Identity for a **write**.
 *
 * Under the default `user` mode this either returns the requester's own
 * credentials or refuses. It never silently downgrades, because a write
 * attributed to a shared bot account is the failure this whole module exists to
 * prevent.
 */
export async function resolveSfdcWrite(ctx: ToolContext): Promise<SfdcIdentity> {
  if (config.salesforce.identity === "service") return { kind: "service" }
  return resolveUserIdentity(ctx, "write")
}

async function resolveUserIdentity(
  ctx: ToolContext,
  operation: "read" | "write"
): Promise<SfdcIdentity> {
  const problem = setupProblem()
  if (problem) {
    return {
      kind: "refused",
      reason:
        `Salesforce is set to per-user identity (SFDC_IDENTITY=${config.salesforce.identity}) but ${problem}. ` +
        "Fix the configuration, or set SFDC_IDENTITY=service to accept that every change is recorded as the service account.",
    }
  }

  const initiator = ctx.session.auth.initiator
  const current = ctx.session.auth.current

  // A schedule has no person to attribute to and cannot answer a sign-in
  // prompt. Refusing is the correct outcome: an unattributed write is exactly
  // what per-user identity exists to prevent. Keep scheduled work read-only.
  if (isAppPrincipal(initiator) || isAppPrincipal(current)) {
    return {
      kind: "refused",
      reason:
        `Scheduled runs cannot ${operation} Salesforce while per-user identity is required, because there is nobody to attribute the change to. ` +
        "Report what needs doing and let a person act on it.",
    }
  }

  // Attribution follows the requester, not whoever approved. After an approval
  // resumes the turn, `current` is the approver — but Salesforce should name
  // the person who asked for the change.
  const requesterEmail = emailOf(initiator) ?? emailOf(current)
  if (!requesterEmail) {
    return {
      kind: "refused",
      reason:
        "Could not determine who is asking, so this change cannot be attributed to anyone in Salesforce. " +
        "In Slack this usually means the bot is missing the users:read.email scope.",
    }
  }

  const resolved = await accessTokenFor(requesterEmail)
  if (resolved) {
    return {
      kind: "user",
      email: requesterEmail,
      credentials: {
        accessToken: resolved.accessToken,
        instanceUrl: resolved.instanceUrl,
      },
    }
  }

  // Not connected. If the requester is the one here right now, park the turn and
  // let them sign in — eve renders the challenge and resumes where it stopped.
  if (emailOf(current) === requesterEmail) {
    const { token } = await ctx.getToken(salesforceUserAuth, {
      authKey: "salesforce",
      displayName: "Salesforce",
    })
    return {
      kind: "user",
      email: requesterEmail,
      credentials: {
        accessToken: token,
        instanceUrl: process.env.SALESFORCE_INSTANCE_URL!,
      },
    }
  }

  // Someone else is here — typically an approver resuming a parked write. They
  // cannot sign in on the requester's behalf, and attributing the change to the
  // approver would misreport who wanted it.
  return {
    kind: "refused",
    reason:
      `${requesterEmail} has not connected their Salesforce account, so this change cannot be recorded under their name. ` +
      "Ask them to make the request themselves and complete the one-time sign-in.",
  }
}

/**
 * Map a Salesforce 401 back into a fresh sign-in challenge.
 *
 * `getToken` only runs *before* a call, so a grant revoked mid-flight surfaces
 * as a downstream 401. Handing that to the model as a tool error would leave the
 * dead token cached; `requireAuth` evicts it and re-prompts.
 */
export function requireSfdcReauth(ctx: ToolContext): never {
  return ctx.requireAuth(salesforceUserAuth, { authKey: "salesforce" })
}

/** True when an error from jsforce looks like an expired or revoked session. */
export function isSfdcAuthError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes("invalid_session_id") ||
    message.includes("session expired") ||
    message.includes("invalid_grant")
  )
}

/** Whether a given person has connected their Salesforce account. */
export async function hasSfdcGrant(email: string | undefined): Promise<boolean> {
  if (!email || !tokenStoreAvailable()) return false
  return !!(await getGrant(email.toLowerCase()))
}
