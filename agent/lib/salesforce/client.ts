/**
 * Salesforce API Client
 *
 * Uses jsforce for SOQL queries and record CRUD.
 *
 * Two credential paths, both routed through `withSfdcRequest`:
 *
 *   1. Service account (default) — SALESFORCE_ACCESS_TOKEN + SALESFORCE_INSTANCE_URL,
 *      optionally refreshable with SALESFORCE_REFRESH_TOKEN + client id/secret.
 *
 *   2. Per-user credentials — pass `{ credentials }`. The tool layer gets these
 *      from eve's interactive authorization (see ./auth.ts), so a write shows the
 *      real person in CreatedById instead of a shared service user. eve owns the
 *      OAuth dance, token storage, and refresh; this module just uses the token.
 *
 * Session-expiry errors are retried once with a fresh connection.
 */

import jsforce, { Connection } from "jsforce"

/** A resolved Salesforce credential pair, from either path above. */
export interface SfdcCredentials {
  accessToken: string
  instanceUrl: string
}

export interface SfdcRequestOptions {
  /**
   * Use these credentials instead of the service account. Supplied by the tool
   * layer from `resolveSfdcWrite` / `resolveSfdcRead`, so a change is recorded
   * under the person who asked for it.
   */
  credentials?: SfdcCredentials | null
}

let cachedConnection: Connection | null = null

export function isSalesforceConfigured(): boolean {
  return !!(
    process.env.SALESFORCE_ACCESS_TOKEN && process.env.SALESFORCE_INSTANCE_URL
  )
}

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
        loginUrl: getLoginUrl(),
      },
      instanceUrl,
      accessToken,
      refreshToken,
    })
  } else {
    cachedConnection = new jsforce.Connection({ instanceUrl, accessToken })
  }

  return cachedConnection
}

export function clearCachedConnection(): void {
  cachedConnection = null
}

export function getLoginUrl(): string {
  return process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com"
}

// ─── Retry / credential routing ──────────────────────────────────────────────

const RETRYABLE_ERRORS = ["INVALID_SESSION_ID", "Session expired"]

function isRetryable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toUpperCase()
  return RETRYABLE_ERRORS.some((needle) => message.includes(needle.toUpperCase()))
}

/**
 * Execute a Salesforce operation, routing to per-user credentials when supplied
 * and retrying once on session expiry.
 */
export async function withSfdcRequest<T>(
  operation: (conn: Connection) => Promise<T>,
  opts: SfdcRequestOptions = {}
): Promise<T> {
  if (opts.credentials) {
    // Per-user path. eve refreshes the token before handing it over, so a
    // session-expiry error here is genuinely stale — surface it and let the
    // tool call ctx.requireAuth() to re-challenge.
    const conn = new jsforce.Connection({
      accessToken: opts.credentials.accessToken,
      instanceUrl: opts.credentials.instanceUrl,
    })
    return operation(conn)
  }

  const conn = getConnection()
  try {
    return await operation(conn)
  } catch (error) {
    if (isRetryable(error)) {
      clearCachedConnection()
      return operation(getConnection())
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
 * jsforce's `conn.query()` returns at most 2000 records — this walks
 * `nextRecordsUrl` until done or until a 120s deadline is hit.
 * Used by the SOQL console, CSV exports, and sandbox data pulls.
 */
export async function queryAllRecords<
  T extends Record<string, unknown> = Record<string, unknown>,
>(soql: string, opts: SfdcRequestOptions = {}): Promise<T[]> {
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
  return withSfdcRequest(async (conn) => conn.sobject(objectName).describe(), opts)
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
        .flatMap((r) => r.errors?.map((e: { message: string }) => e.message) || []),
    }
  }, opts)
}

/**
 * Insert many records in one operation.
 *
 * The gap this closes: without it, importing a 600-row list meant 600 separate
 * single-record creates — 600 tool calls, and for a non-approver, 600 approval
 * prompts. The list-import workflow was describable but not executable.
 *
 * Salesforce's collections API caps a request at 200 records, so this chunks.
 * `allOrNone` is false per chunk: on a partial failure the good rows land and
 * the bad ones come back with reasons, which is what you want on an import —
 * failing 600 rows because two had a bad country code is not helpful.
 */
export async function createRecords(
  objectName: string,
  records: Array<Record<string, unknown>>,
  opts: SfdcRequestOptions = {}
): Promise<{
  created: string[]
  failed: Array<{ row: number; errors: string[] }>
}> {
  const CHUNK = 200
  const created: string[] = []
  const failed: Array<{ row: number; errors: string[] }> = []

  for (let offset = 0; offset < records.length; offset += CHUNK) {
    const chunk = records.slice(offset, offset + CHUNK)
    const results = await withSfdcRequest(async (conn) => {
      const outcome = await conn.sobject(objectName).create(chunk)
      return Array.isArray(outcome) ? outcome : [outcome]
    }, opts)

    results.forEach((result, index) => {
      if (result.success) {
        created.push(result.id)
      } else {
        failed.push({
          row: offset + index,
          errors: result.errors?.map((error: { message: string }) => error.message) ?? [
            "unknown error",
          ],
        })
      }
    })
  }

  return { created, failed }
}

/**
 * Find which of a set of values already exist, by field.
 *
 * This is the dedupe primitive. SOQL has a hard query-length limit, so a
 * thousand emails cannot go in one `IN` clause — hence chunking, which the
 * agent should not have to reinvent (and get subtly wrong) in a prompt.
 *
 * Returns a map from the normalized value to the matching records, so a caller
 * can distinguish "already a Contact" from "already a Lead".
 */
export async function findByFieldValues(
  objectName: string,
  field: string,
  values: string[],
  opts: SfdcRequestOptions & { extraFields?: string[] } = {}
): Promise<Map<string, Record<string, unknown>[]>> {
  // 200 values per query keeps the statement well inside SOQL's length limit
  // even with long addresses.
  const CHUNK = 200
  const found = new Map<string, Record<string, unknown>[]>()
  const fields = Array.from(new Set(["Id", field, ...(opts.extraFields ?? [])]))

  const unique = Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))
  )

  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const chunk = unique.slice(offset, offset + CHUNK)
    // Escape single quotes and backslashes; an apostrophe in an address would
    // otherwise break the statement or, worse, alter it.
    const list = chunk
      .map((value) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
      .join(",")

    const soql = `SELECT ${fields.join(", ")} FROM ${objectName} WHERE ${field} IN (${list})`
    const records = await queryAllRecords(soql, opts)

    for (const record of records) {
      const key = String(record[field] ?? "").trim().toLowerCase()
      if (!key) continue
      const existing = found.get(key)
      if (existing) existing.push(record)
      else found.set(key, [record])
    }
  }

  return found
}
