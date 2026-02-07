/**
 * Salesforce API Client
 *
 * Uses jsforce for SOQL queries, record CRUD, and OAuth.
 * Requires SALESFORCE_ACCESS_TOKEN, SALESFORCE_INSTANCE_URL.
 */

import jsforce, { Connection } from "jsforce"

let _conn: Connection | null = null

export function getConnection(): Connection {
  if (_conn) return _conn

  const accessToken = process.env.SALESFORCE_ACCESS_TOKEN
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL

  if (!accessToken || !instanceUrl) {
    throw new Error(
      "Salesforce not configured. Set SALESFORCE_ACCESS_TOKEN and SALESFORCE_INSTANCE_URL."
    )
  }

  _conn = new jsforce.Connection({
    instanceUrl,
    accessToken,
  })

  // Handle token refresh if configured
  const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET

  if (refreshToken && clientId && clientSecret) {
    _conn = new jsforce.Connection({
      oauth2: {
        clientId,
        clientSecret,
        loginUrl: process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com",
      },
      instanceUrl,
      accessToken,
      refreshToken,
    })
  }

  return _conn
}

export async function query(soql: string): Promise<Record<string, unknown>[]> {
  const conn = getConnection()
  const result = await conn.query(soql)
  return result.records as Record<string, unknown>[]
}

export async function describeObject(objectName: string) {
  const conn = getConnection()
  return conn.sobject(objectName).describe()
}

export async function describeGlobal() {
  const conn = getConnection()
  return conn.describeGlobal()
}

export async function addToCampaign(
  campaignId: string,
  contactIds: string[],
  status?: string
): Promise<{ success: number; failed: number }> {
  const conn = getConnection()
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
}

export async function updateRecord(
  objectName: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const conn = getConnection()
  const result = await conn.sobject(objectName).update({ Id: id, ...data })
  if (!result.success) {
    throw new Error(
      `Failed to update ${objectName}: ${JSON.stringify(result.errors)}`
    )
  }
}

export async function createRecord(
  objectName: string,
  data: Record<string, unknown>
): Promise<string> {
  const conn = getConnection()
  const result = await conn.sobject(objectName).create(data)
  if (!result.success) {
    throw new Error(
      `Failed to create ${objectName}: ${JSON.stringify(result.errors)}`
    )
  }
  return result.id
}

export async function deleteRecord(
  objectName: string,
  id: string
): Promise<void> {
  const conn = getConnection()
  const result = await conn.sobject(objectName).destroy(id)
  if (!result.success) {
    throw new Error(
      `Failed to delete ${objectName}: ${JSON.stringify(result.errors)}`
    )
  }
}

export async function bulkUpdateRecords(
  objectName: string,
  records: Array<{ Id: string; [key: string]: unknown }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const conn = getConnection()
  const results = await conn.sobject(objectName).update(records)
  const resultsArray = Array.isArray(results) ? results : [results]

  return {
    success: resultsArray.filter((r) => r.success).length,
    failed: resultsArray.filter((r) => !r.success).length,
    errors: resultsArray
      .filter((r) => !r.success)
      .flatMap((r) => r.errors?.map((e: { message: string }) => e.message) || []),
  }
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
