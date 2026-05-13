/**
 * Salesforce API Client
 *
 * Uses jsforce for SOQL queries, record CRUD, and OAuth.
 * Requires SALESFORCE_ACCESS_TOKEN, SALESFORCE_INSTANCE_URL.
 *
 * Every method routes through `withSfdcRequest`, which:
 *   - Retries once on session-expiry errors with a fresh connection
 *   - Honors `opts.slackUserId` when SFDC_USER_OAUTH_ENABLED=true: looks up
 *     the user's stored encrypted refresh token, falls back to the service
 *     account if they haven't connected. (Plumbing only — existing tools
 *     pass no opts, so they all use the service account today.)
 */

import jsforce, { Connection } from "jsforce"
import {
  getConnectionForUser,
  SFDC_USER_OAUTH_FEATURE_ENABLED,
} from "./user-auth/connection"
import {
  deleteUserSfdcToken,
  touchUserSfdcToken,
} from "./user-auth/store"

let cachedConnection: Connection | null = null

export function getConnection(): Connection {
  if (cachedConnection) return cachedConnection

  const accessToken = process.env.SALESFORCE_ACCESS_TOKEN
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL

  if (!accessToken || !instanceUrl) {
    throw new Error(
      "Salesforce not configured. Set SALESFORCE_ACCESS_TOKEN and SALESFORCE_INSTANCE_URL."
    )
  }

  const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET

  if (refreshToken && clientId && clientSecret) {
    cachedConnection = new jsforce.Connection({
      oauth2: {
        clientId,
        clientSecret,
        loginUrl: process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com",
      },
      instanceUrl,
      accessToken,
      refreshToken,
    })
  } else {
    cachedConnection = new jsforce.Connection({
      instanceUrl,
      accessToken,
    })
  }

  return cachedConnection
}

export function clearCachedConnection(): void {
  cachedConnection = null
}

// ─── Retry / per-user wrapper ────────────────────────────────────────────────

const RETRYABLE_ERRORS = ["INVALID_SESSION_ID", "Session expired"]
const PERMANENT_USER_AUTH_ERRORS = [
  "invalid_grant",
  "expired access/refresh token",
  "expired authorization",
]

export interface SfdcRequestOptions {
  /**
   * If set and SFDC_USER_OAUTH_ENABLED=true, prefer this Slack user's
   * stored Salesforce token; fall back to the service account if they
   * haven't connected. Defaults to using the service account.
   */
  slackUserId?: string | null
}

/**
 * Execute a Salesforce operation with retry-on-session-expiry and (when
 * enabled + a slackUserId is passed) per-user connection routing.
 */
export async function withSfdcRequest<T>(
  operation: (conn: Connection) => Promise<T>,
  opts: SfdcRequestOptions = {}
): Promise<T> {
  // Per-user path
  if (SFDC_USER_OAUTH_FEATURE_ENABLED && opts.slackUserId) {
    const userConn = await getConnectionForUser(opts.slackUserId)
    if (userConn) {
      try {
        const result = await operation(userConn)
        touchUserSfdcToken(opts.slackUserId).catch(() => {})
        return result
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
        if (PERMANENT_USER_AUTH_ERRORS.some((needle) => message.includes(needle))) {
          await deleteUserSfdcToken(opts.slackUserId).catch(() => {})
          throw new Error(
            "Your Salesforce connection expired or was revoked. Run `/moperator connect-sfdc` to reconnect."
          )
        }
        if (RETRYABLE_ERRORS.some((e) => message.toUpperCase().includes(e.toUpperCase()))) {
          return await operation(userConn)
        }
        throw error
      }
    }
    // No stored token — fall through to service account
  }

  // Service-account path with one-shot retry on session expiry
  const conn = getConnection()
  try {
    return await operation(conn)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (RETRYABLE_ERRORS.some((e) => message.includes(e))) {
      clearCachedConnection()
      const fresh = getConnection()
      return operation(fresh)
    }
    throw error
  }
}

// ─── Core operations ─────────────────────────────────────────────────────────

export async function query(
  soql: string,
  opts: SfdcRequestOptions = {}
): Promise<Record<string, unknown>[]> {
  return withSfdcRequest(async (conn) => {
    const result = await conn.query(soql)
    return result.records as Record<string, unknown>[]
  }, opts)
}

/**
 * Execute a full paginated SOQL query, returning every record.
 * jsforce's `conn.query()` returns at most 2000 records — this method
 * walks `nextRecordsUrl` until done or until a 120s deadline is hit.
 * Use this for the SOQL Console and CSV exports.
 */
export async function queryAllRecords<T extends Record<string, unknown> = Record<string, unknown>>(
  soql: string,
  opts: SfdcRequestOptions = {}
): Promise<T[]> {
  return withSfdcRequest(async (conn) => {
    const deadline = Date.now() + 120_000
    let result = await conn.query<T>(soql)
    const records = [...result.records]
    while (!result.done && result.nextRecordsUrl) {
      if (Date.now() > deadline) {
        console.warn(
          "[Salesforce] queryAllRecords hit 120s deadline, returning partial results",
          { recordsSoFar: records.length }
        )
        break
      }
      result = await conn.queryMore<T>(result.nextRecordsUrl)
      records.push(...result.records)
    }
    return records
  }, opts)
}

export async function describeObject(
  objectName: string,
  opts: SfdcRequestOptions = {}
) {
  return withSfdcRequest(
    async (conn) => conn.sobject(objectName).describe(),
    opts
  )
}

export async function describeGlobal(opts: SfdcRequestOptions = {}) {
  return withSfdcRequest(async (conn) => conn.describeGlobal(), opts)
}

export async function addToCampaign(
  campaignId: string,
  contactIds: string[],
  status?: string,
  opts: SfdcRequestOptions = {}
): Promise<{ success: number; failed: number }> {
  return withSfdcRequest(async (conn) => {
    const records = contactIds.map((id) => ({
      CampaignId: campaignId,
      ContactId: id,
      Status: status || "Sent",
    }))

    const results = await conn.sobject("CampaignMember").create(records)
    const resultsArray = Array.isArray(results) ? results : [results]

    return {
      success: resultsArray.filter((r) => r.success).length,
      failed: resultsArray.filter((r) => !r.success).length,
    }
  }, opts)
}

export async function updateRecord(
  objectName: string,
  id: string,
  data: Record<string, unknown>,
  opts: SfdcRequestOptions = {}
): Promise<void> {
  return withSfdcRequest(async (conn) => {
    const result = await conn.sobject(objectName).update({ Id: id, ...data })
    if (!result.success) {
      throw new Error(
        `Failed to update ${objectName}: ${JSON.stringify(result.errors)}`
      )
    }
  }, opts)
}

export async function createRecord(
  objectName: string,
  data: Record<string, unknown>,
  opts: SfdcRequestOptions = {}
): Promise<string> {
  return withSfdcRequest(async (conn) => {
    const result = await conn.sobject(objectName).create(data)
    if (!result.success) {
      throw new Error(
        `Failed to create ${objectName}: ${JSON.stringify(result.errors)}`
      )
    }
    return result.id
  }, opts)
}

export async function deleteRecord(
  objectName: string,
  id: string,
  opts: SfdcRequestOptions = {}
): Promise<void> {
  return withSfdcRequest(async (conn) => {
    const result = await conn.sobject(objectName).destroy(id)
    if (!result.success) {
      throw new Error(
        `Failed to delete ${objectName}: ${JSON.stringify(result.errors)}`
      )
    }
  }, opts)
}

export async function bulkUpdateRecords(
  objectName: string,
  records: Array<{ Id: string; [key: string]: unknown }>,
  opts: SfdcRequestOptions = {}
): Promise<{ success: number; failed: number; errors: string[] }> {
  return withSfdcRequest(async (conn) => {
    const results = await conn.sobject(objectName).update(records)
    const resultsArray = Array.isArray(results) ? results : [results]

    return {
      success: resultsArray.filter((r) => r.success).length,
      failed: resultsArray.filter((r) => !r.success).length,
      errors: resultsArray
        .filter((r) => !r.success)
        .flatMap(
          (r) => r.errors?.map((e: { message: string }) => e.message) || []
        ),
    }
  }, opts)
}

// ─── OAuth Helpers ────────────────────────────────────────────────────────────

export function getAuthorizationUrl(): string {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const loginUrl =
    process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const redirectUri = `${appUrl}/api/integrations/salesforce/callback`

  if (!clientId) {
    throw new Error("SALESFORCE_CLIENT_ID not configured")
  }

  return `${loginUrl}/services/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=api%20refresh_token%20offline_access`
}

export async function exchangeCodeForTokens(code: string) {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  const loginUrl =
    process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const redirectUri = `${appUrl}/api/integrations/salesforce/callback`

  if (!clientId || !clientSecret) {
    throw new Error(
      "SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required"
    )
  }

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })

  const data = await res.json()

  if (data.error) {
    throw new Error(`OAuth error: ${data.error_description || data.error}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    instanceUrl: data.instance_url,
  }
}
