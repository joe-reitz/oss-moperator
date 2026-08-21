/**
 * Iterable client.
 *
 * One credential (`ITERABLE_API_KEY`) in an `Api-Key` header. Keys are
 * project-scoped: a key from one Iterable project cannot read or write another,
 * so "empty results" usually means right key, wrong project.
 *
 * Three behaviours here are Iterable-specific and each one has bitten someone:
 *
 *   1. **A 200 can still be a failure.** Most endpoints return
 *      `{msg, code, params}` where `code` is `"Success"` or an error name. A bad
 *      list id comes back HTTP 200 with a non-Success code, so checking
 *      `res.ok` alone silently swallows it.
 *   2. **`lists/getUsers` returns plain text**, not JSON — newline-separated
 *      email addresses. `res.json()` throws on it.
 *   3. **Email and userId are two identity models.** Email is the default
 *      primary key; `preferUserId` switches it. Mixing the two across calls
 *      creates split profiles that are painful to merge afterwards.
 */

/** Iterable's documented ceiling for list subscribe/unsubscribe and bulk update. */
export const MAX_PER_CALL = 1000

function base(): string {
  return (process.env.ITERABLE_REGION || "us").trim().toLowerCase() === "eu"
    ? "https://api.eu.iterable.com/api"
    : "https://api.iterable.com/api"
}

function apiKey(): string {
  const key = process.env.ITERABLE_API_KEY
  if (!key) {
    throw new Error("Iterable not configured. Set ITERABLE_API_KEY.")
  }
  return key
}

function headers(): Record<string, string> {
  return { "Api-Key": apiKey(), "Content-Type": "application/json" }
}

/**
 * Iterable's response envelope. `code` is the real verdict — HTTP 200 with
 * `code: "BadParams"` is a failure that `res.ok` reports as success.
 */
interface IterableEnvelope {
  msg?: string
  code?: string
  params?: unknown
}

function assertSuccess(payload: unknown, what: string): unknown {
  if (payload && typeof payload === "object") {
    const env = payload as IterableEnvelope
    if (typeof env.code === "string" && env.code !== "Success") {
      throw new Error(
        `Iterable ${what} failed: ${env.code}${env.msg ? ` — ${env.msg}` : ""}`
      )
    }
  }
  return payload
}

async function request(
  path: string,
  options: RequestInit = {},
  what = "request"
): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  })

  const text = await res.text()

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        `Iterable 401. Check ITERABLE_API_KEY, and that ITERABLE_REGION matches the project's data centre (currently "${(process.env.ITERABLE_REGION || "us").toLowerCase()}").`
      )
    }
    if (res.status === 429) {
      throw new Error(
        `Iterable 429 (rate limited) on ${what}. Limits are per-endpoint — users/update is generous, most others are not.`
      )
    }
    throw new Error(`Iterable API error ${res.status} on ${what}: ${text}`)
  }

  if (!text) return { ok: true }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Some endpoints (notably lists/getUsers) return plain text.
    return { raw: text }
  }

  return assertSuccess(parsed, what)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<unknown> {
  return request(
    `/users/getByEmail?email=${encodeURIComponent(email)}`,
    {},
    "get user"
  )
}

/**
 * Create or update one user. Upsert — an unknown email creates a profile.
 *
 * `dataFields` is where everything custom lives. Iterable infers a type per
 * field on first write and then rejects conflicting types, so a field that was
 * ever written as a string will refuse a number later.
 */
export async function updateUser(input: {
  email?: string
  userId?: string
  dataFields: Record<string, unknown>
  preferUserId?: boolean
}): Promise<unknown> {
  if (!input.email && !input.userId) {
    throw new Error("Iterable needs either an email or a userId to identify a user.")
  }
  return request(
    "/users/update",
    { method: "POST", body: JSON.stringify(input) },
    "update user"
  )
}

/** Bulk upsert, chunked at Iterable's 1,000-per-call ceiling. */
export async function bulkUpdateUsers(
  users: Array<{ email?: string; userId?: string; dataFields: Record<string, unknown> }>
): Promise<unknown> {
  const batches = chunk(users, MAX_PER_CALL)
  const results: unknown[] = []

  for (const batch of batches) {
    results.push(
      await request(
        "/users/bulkUpdate",
        { method: "POST", body: JSON.stringify({ users: batch }) },
        "bulk update users"
      )
    )
  }

  return { batches: batches.length, total: users.length, results }
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function listLists(): Promise<unknown> {
  return request("/lists", {}, "list lists")
}

/**
 * Members of a static list.
 *
 * This endpoint answers with plain text — one email per line — so it is parsed
 * here rather than handed back raw. Large lists are large responses; prefer a
 * count where a count is what was asked for.
 */
export async function getListUsers(listId: number | string): Promise<{
  listId: string
  count: number
  emails: string[]
}> {
  const result = (await request(
    `/lists/getUsers?listId=${encodeURIComponent(String(listId))}`,
    {},
    "get list users"
  )) as { raw?: string }

  const emails = (result.raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  return { listId: String(listId), count: emails.length, emails }
}

/**
 * Add people to a static list. Creates users that do not exist yet.
 *
 * Chunked at 1,000. Iterable reports per-call counts rather than failing whole,
 * so the caller gets every batch's response back instead of a single boolean.
 */
export async function subscribeToList(
  listId: number | string,
  emails: string[]
): Promise<unknown> {
  const batches = chunk(emails, MAX_PER_CALL)
  const results: unknown[] = []

  for (const batch of batches) {
    results.push(
      await request(
        "/lists/subscribe",
        {
          method: "POST",
          body: JSON.stringify({
            listId: Number(listId),
            subscribers: batch.map((email) => ({ email })),
          }),
        },
        "subscribe to list"
      )
    )
  }

  return { listId: String(listId), total: emails.length, batches: batches.length, results }
}

export async function unsubscribeFromList(
  listId: number | string,
  emails: string[]
): Promise<unknown> {
  const batches = chunk(emails, MAX_PER_CALL)
  const results: unknown[] = []

  for (const batch of batches) {
    results.push(
      await request(
        "/lists/unsubscribe",
        {
          method: "POST",
          body: JSON.stringify({
            listId: Number(listId),
            subscribers: batch.map((email) => ({ email })),
          }),
        },
        "unsubscribe from list"
      )
    )
  }

  return { listId: String(listId), total: emails.length, batches: batches.length, results }
}

// ─── Campaigns and templates ──────────────────────────────────────────────────

export async function listCampaigns(): Promise<unknown> {
  return request("/campaigns", {}, "list campaigns")
}

export async function getCampaignMetrics(
  campaignIds: Array<number | string>,
  startDateTime?: string,
  endDateTime?: string
): Promise<unknown> {
  const params = new URLSearchParams()
  for (const id of campaignIds) params.append("campaignId", String(id))
  if (startDateTime) params.set("startDateTime", startDateTime)
  if (endDateTime) params.set("endDateTime", endDateTime)

  return request(`/campaigns/metrics?${params.toString()}`, {}, "campaign metrics")
}

export async function listTemplates(): Promise<unknown> {
  return request("/templates", {}, "list templates")
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function trackEvent(input: {
  email?: string
  userId?: string
  eventName: string
  dataFields?: Record<string, unknown>
}): Promise<unknown> {
  return request(
    "/events/track",
    { method: "POST", body: JSON.stringify(input) },
    "track event"
  )
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/**
 * Send one campaign's email to one person.
 *
 * This is a real send to a real address. It targets an existing campaign rather
 * than composing a message, so the campaign has to exist and be sendable.
 */
export async function sendEmailToUser(input: {
  campaignId: number | string
  recipientEmail?: string
  recipientUserId?: string
  dataFields?: Record<string, unknown>
}): Promise<unknown> {
  if (!input.recipientEmail && !input.recipientUserId) {
    throw new Error("Iterable needs a recipientEmail or recipientUserId to send.")
  }
  return request(
    "/email/target",
    {
      method: "POST",
      body: JSON.stringify({
        campaignId: Number(input.campaignId),
        ...(input.recipientEmail ? { recipientEmail: input.recipientEmail } : {}),
        ...(input.recipientUserId ? { recipientUserId: input.recipientUserId } : {}),
        ...(input.dataFields ? { dataFields: input.dataFields } : {}),
      }),
    },
    "send email"
  )
}

/** Cheapest authenticated read, for `agent:doctor`. */
export async function ping(): Promise<unknown> {
  return listLists()
}
