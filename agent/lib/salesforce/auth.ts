/**
 * Per-user Salesforce authorization.
 *
 * When SFDC_USER_OAUTH_ENABLED=true, Salesforce writes resolve a token for the
 * *person* making the request instead of the shared service account, so
 * `CreatedById` / `LastModifiedById` shows who actually did it.
 *
 * The division of labour with eve is worth being precise about, because it is
 * not "eve does OAuth for you":
 *
 *   eve owns the flow — it mints the callback URL, parks the turn durably at the
 *   sign-in prompt for as long as it takes, resumes exactly where it stopped,
 *   and renders the challenge natively per channel (an ephemeral Slack message,
 *   an inline prompt in the browser chat). That is what replaced this repo's
 *   PKCE helpers, OAuth state store, and three callback routes.
 *
 *   We own persistence. eve caches a resolved token per step and treats
 *   `getToken` as the source of truth, so the refresh token lives in
 *   `./token-store.ts`, encrypted, keyed by principal.
 *
 * Falls back to the service account whenever the feature is off, whenever the
 * caller has no user identity (a schedule), or whenever the store is not
 * configured — so turning this on can never take away the ability to work.
 */

import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  defineInteractiveAuthorization,
} from "eve/connections"
import type { ToolContext } from "eve/tools"

import { getLoginUrl, type SfdcCredentials } from "./client"
import { getGrant, putGrant, tokenStoreAvailable, touchGrant } from "./token-store"

export const SFDC_USER_OAUTH_ENABLED =
  process.env.SFDC_USER_OAUTH_ENABLED === "true"

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
      "Per-user Salesforce OAuth needs SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET. " +
        "Set them, or unset SFDC_USER_OAUTH_ENABLED to use the service account."
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
    // A user who clicked Deny should not be asked again in a loop.
    retryable: !TERMINAL_ERRORS.some((needle) => detail.includes(needle)),
  })
}

/**
 * The authorization provider.
 *
 * `getToken` runs before every gated call: it looks up the person's stored
 * grant, exchanges the refresh token for a fresh access token, and throws
 * `Required` when there is nothing stored — which is what starts the sign-in.
 */
export const salesforceUserAuth = defineInteractiveAuthorization<{
  instanceUrl: string
}>({
  async getToken({ principal }) {
    // `principalType` is pinned to "user" for interactive auth, so a grant is
    // always keyed to a person. An app principal here means the session had no
    // end user and there is nothing to look up.
    const principalId = principal.type === "user" ? principal.id : undefined
    if (!principalId) throw new ConnectionAuthorizationRequiredError("salesforce")

    const grant = await getGrant(principalId)
    if (!grant) throw new ConnectionAuthorizationRequiredError("salesforce")

    const { clientId, clientSecret } = clientCredentials()
    const data = await postToken({
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })

    if (data.error || !data.access_token) {
      // Revoked or expired in Salesforce. Drop nothing — the next
      // `completeAuthorization` overwrites it — and start a fresh sign-in.
      throw new ConnectionAuthorizationRequiredError("salesforce")
    }

    void touchGrant(principalId)

    return {
      token: data.access_token,
      // Salesforce access tokens are session-lifetime; refresh a little early.
      expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3_600_000) - 60_000,
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
      failAuthorization(
        data.error ?? "token_exchange_failed",
        data.error_description
      )
    }

    const instanceUrl =
      data.instance_url || process.env.SALESFORCE_INSTANCE_URL || ""

    // Persist the refresh token so later turns and later days do not re-prompt.
    // Without one, Salesforce gave us a session-only grant; still usable now.
    if (data.refresh_token && principal.type === "user") {
      await putGrant({
        principalId: principal.id,
        instanceUrl,
        refreshToken: data.refresh_token,
      })
    }

    return { token: data.access_token! }
  },
})

/**
 * Resolve the Salesforce credentials for the current turn.
 *
 * `null` means "use the service account", which is the right answer more often
 * than not: the feature is off, the caller is a schedule with nobody to sign in,
 * or the deployment has no encrypted store to keep a grant in.
 */
export async function resolveSfdcCredentials(
  ctx: ToolContext
): Promise<SfdcCredentials | null> {
  if (!SFDC_USER_OAUTH_ENABLED) return null

  // A schedule or other runtime-initiated turn has no person to attribute the
  // write to, and could not answer a sign-in prompt if we raised one.
  if (ctx.session.auth.current?.principalType !== "user") return null

  if (!tokenStoreAvailable()) {
    console.warn(
      "[salesforce] SFDC_USER_OAUTH_ENABLED is set but Redis or MOPERATOR_TOKEN_ENCRYPTION_KEY is missing; using the service account."
    )
    return null
  }

  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL
  if (!instanceUrl) return null

  const { token } = await ctx.getToken(salesforceUserAuth, {
    authKey: "salesforce",
    displayName: "Salesforce",
  })

  return { accessToken: token, instanceUrl }
}

/**
 * Map a Salesforce 401 back into a fresh sign-in challenge.
 *
 * `getToken` only runs *before* a call, so a grant revoked mid-flight first
 * surfaces as a downstream 401. Handing that to the model as a tool error would
 * leave the dead token cached; `requireAuth` evicts it and re-prompts.
 */
export function requireSfdcReauth(ctx: ToolContext): never {
  return ctx.requireAuth(salesforceUserAuth, { authKey: "salesforce" })
}

/** True when an error from jsforce looks like an expired or revoked session. */
export function isSfdcAuthError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase()
  return (
    message.includes("invalid_session_id") ||
    message.includes("session expired") ||
    message.includes("invalid_grant")
  )
}
