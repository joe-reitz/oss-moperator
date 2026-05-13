/**
 * Build a jsforce Connection that acts AS a specific Slack user, using
 * their stored Salesforce refresh token. Falls back to null if the user
 * hasn't connected — callers fall back to the service account.
 *
 * On invalid_grant / expired refresh token, the calling withSfdcRequest
 * wrapper deletes the stored record so the user is forced to reconnect
 * on the next interaction.
 */
import jsforce, { Connection } from "jsforce"
import { getUserSfdcToken, touchUserSfdcToken } from "./store"

export const SFDC_USER_OAUTH_FEATURE_ENABLED =
  process.env.SFDC_USER_OAUTH_ENABLED === "true"

const USER_REDIRECT_PATH = "/api/integrations/salesforce/user-callback"

/** Per-user OAuth2 config. Distinct from the service-account flow. */
export function getUserOAuth2() {
  return new jsforce.OAuth2({
    clientId: process.env.SALESFORCE_CLIENT_ID!,
    clientSecret: process.env.SALESFORCE_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}${USER_REDIRECT_PATH}`,
    loginUrl: process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com",
  })
}

/** OAuth scope set requested for per-user connections. */
export const USER_OAUTH_SCOPES = "api refresh_token offline_access"

/**
 * Build the SFDC authorization URL the user clicks. `state` is the
 * server-side nonce stored in oauth-state.ts; SFDC echoes it back to the
 * callback. `codeChallenge` is the PKCE challenge.
 */
export function buildUserAuthorizationUrl(state: string, codeChallenge: string): string {
  return getUserOAuth2().getAuthorizationUrl({
    scope: USER_OAUTH_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })
}

/**
 * Try to load the user's stored token and return a fresh jsforce
 * Connection. Returns null when:
 *   - the feature flag is off
 *   - the user has no stored token
 */
export async function getConnectionForUser(
  slackUserId: string | undefined | null
): Promise<Connection | null> {
  if (!SFDC_USER_OAUTH_FEATURE_ENABLED) return null
  if (!slackUserId) return null

  const stored = await getUserSfdcToken(slackUserId)
  if (!stored) return null

  const conn = new jsforce.Connection({
    oauth2: getUserOAuth2(),
    instanceUrl: stored.instanceUrl,
    refreshToken: stored.refreshToken,
  })

  conn.on("refresh", () => {
    touchUserSfdcToken(slackUserId).catch(() => {})
  })

  return conn
}
