/**
 * Inflection client.
 *
 * B2B marketing automation. One credential (`INFLECTION_API_TOKEN`) — a Personal
 * Access Token, or an OAuth 2.1 access token — as a bearer token against
 * `https://api.inflection.io/v1`.
 *
 * Three things about this API shape the whole client:
 *
 *   1. **Everything is wrapped in an envelope.** `{data, pagination?, errors[],
 *      meta:{status, timestamp}}`. `meta.status` is `SUCCESS` or `FAILURE`, and
 *      `errors` can be non-empty on an HTTP 200 — that is how partial success is
 *      reported, so the envelope is unwrapped in one place here.
 *
 *   2. **Contact writes are asynchronous.** `POST`/`PATCH /v1/contacts*` return a
 *      PENDING transaction, not a contact. You poll
 *      `GET /v1/contacts/transactions/{id}` until `status` is `DONE`. A bad
 *      transaction id returns `NOT_EXIST` — over HTTP 200, so the status code
 *      cannot be trusted to detect it.
 *
 *   3. **Contact property keys must be snake_case.** camelCase keys are
 *      *silently ignored and saved as null*. That is data loss with no error, so
 *      this client refuses camelCase up front rather than letting it through.
 *      Note the asymmetry: property keys are snake_case, but request *body*
 *      fields are camelCase (`contactIds`, `transactionId`).
 */

/** Inflection's documented ceiling for a batch upsert, handled as one transaction. */
export const MAX_BATCH = 1000

const BASE = "https://api.inflection.io/v1"

function token(): string {
  const t = process.env.INFLECTION_API_TOKEN
  if (!t) {
    throw new Error(
      "Inflection not configured. Set INFLECTION_API_TOKEN to a Personal Access Token (Settings → API → Personal Access Tokens)."
    )
  }
  return t
}

interface Envelope {
  data?: unknown
  pagination?: {
    pageNumber?: number
    pageSize?: number
    totalElements?: number
    totalPages?: number
  }
  errors?: Array<{ errorCode?: string; message?: string; detail?: string }>
  meta?: { status?: string; timestamp?: string }
}

export interface Transaction {
  transactionId: string
  status: "PENDING" | "DONE" | "NOT_EXIST"
  /** Per-contact outcomes, present only once status is DONE. */
  results?: Array<{ email?: string; status?: string }>
}

function describeErrors(errors: Envelope["errors"]): string {
  if (!errors?.length) return ""
  return errors
    .map((e) =>
      [e.errorCode, e.message, e.detail].filter(Boolean).join(": ")
    )
    .join("; ")
}

async function request(
  path: string,
  options: RequestInit = {},
  what = "request"
): Promise<{ data: unknown; pagination?: Envelope["pagination"]; warnings?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  const text = await res.text()
  let body: Envelope = {}
  if (text) {
    try {
      body = JSON.parse(text) as Envelope
    } catch {
      throw new Error(`Inflection returned non-JSON on ${what}: ${text.slice(0, 200)}`)
    }
  }

  if (!res.ok) {
    const detail = describeErrors(body.errors) || text.slice(0, 300)

    if (res.status === 401) {
      throw new Error(
        `Inflection 401 on ${what}. INFLECTION_API_TOKEN is missing, expired, or revoked.`
      )
    }
    if (res.status === 403) {
      throw new Error(
        `Inflection 403 on ${what}. The token authenticated but lacks permission — reads need READ, writes need WRITE scope.`
      )
    }
    // A missing contact is a 400 with BAS-E-002, not a 404.
    if (res.status === 400 && detail.includes("BAS-E-002")) {
      throw new Error(`Not found in Inflection (${what}).`)
    }
    throw new Error(`Inflection API error ${res.status} on ${what}: ${detail}`)
  }

  // A 200 can still carry errors — that is the partial-success channel.
  const warnings = describeErrors(body.errors)

  if (body.meta?.status === "FAILURE") {
    throw new Error(
      `Inflection reported FAILURE on ${what}${warnings ? `: ${warnings}` : ""}`
    )
  }

  return {
    data: body.data,
    ...(body.pagination ? { pagination: body.pagination } : {}),
    ...(warnings ? { warnings } : {}),
  }
}

// ─── The snake_case guard ─────────────────────────────────────────────────────

/**
 * Reject camelCase property keys before they become nulls.
 *
 * Inflection accepts the write, returns success, and stores null. There is no
 * error to catch later, so this is the only place it can be caught at all.
 */
export function assertSnakeCaseKeys(
  properties: Record<string, unknown>,
  where = "properties"
): void {
  const offenders = Object.keys(properties).filter((k) => /[A-Z]/.test(k))
  if (!offenders.length) return

  const fixes = offenders
    .map((k) => `${k} → ${k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`)
    .join(", ")

  throw new Error(
    `Inflection ${where} keys must be snake_case — camelCase keys are silently saved as null. Rename: ${fixes}`
  )
}

// ─── Contacts (read — synchronous) ────────────────────────────────────────────

export async function getContactById(id: string) {
  return request(`/contacts/${encodeURIComponent(id)}`, {}, "get contact")
}

export async function getContactByEmail(email: string) {
  return request(
    `/contacts/by-email/${encodeURIComponent(email)}`,
    {},
    "get contact by email"
  )
}

export async function getMarketingActivity(contactId: string) {
  return request(
    `/contacts/${encodeURIComponent(contactId)}/marketing-activity`,
    {},
    "get marketing activity"
  )
}

export async function getProductActivity(contactId: string) {
  return request(
    `/contacts/${encodeURIComponent(contactId)}/product-activity`,
    {},
    "get product activity"
  )
}

export async function getActivityLog(contactId: string) {
  return request(
    `/contacts/${encodeURIComponent(contactId)}/activity-log`,
    {},
    "get activity log"
  )
}

// ─── Contacts (write — asynchronous) ──────────────────────────────────────────

function toTransaction(data: unknown): Transaction {
  const t = (data || {}) as {
    transactionId?: string
    status?: string
    data?: { results?: Array<{ email?: string; status?: string }> }
  }
  return {
    transactionId: t.transactionId || "",
    status: (t.status as Transaction["status"]) || "PENDING",
    ...(t.data?.results ? { results: t.data.results } : {}),
  }
}

export async function getTransaction(transactionId: string): Promise<Transaction> {
  const { data } = await request(
    `/contacts/transactions/${encodeURIComponent(transactionId)}`,
    {},
    "get transaction"
  )
  return toTransaction(data)
}

/**
 * Poll a transaction to completion.
 *
 * Bounded on purpose. A tool that hands the model a PENDING transaction id has
 * told it nothing, but an unbounded poll can hang a turn — so this waits a short
 * while and, if the write is still in flight, returns the PENDING transaction so
 * the caller can report the id and check it later.
 */
export async function waitForTransaction(
  transactionId: string,
  { attempts = 8, intervalMs = 750 }: { attempts?: number; intervalMs?: number } = {}
): Promise<Transaction> {
  let last: Transaction = { transactionId, status: "PENDING" }

  for (let i = 0; i < attempts; i++) {
    last = await getTransaction(transactionId)

    if (last.status === "DONE") return last
    if (last.status === "NOT_EXIST") {
      throw new Error(
        `Inflection does not recognise transaction ${transactionId}. It returns NOT_EXIST over HTTP 200, so this is a real miss rather than a transport error.`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return last
}

/**
 * Create or update contacts by email.
 *
 * Always uses the batch endpoint, even for one contact: a plain POST to the
 * single-contact endpoint only *creates*, so it fails on anyone who already
 * exists. Batch upsert is the dependable create-or-update route.
 */
export async function upsertContacts(
  contacts: Array<{ email: string; properties?: Record<string, unknown> }>,
  { wait = true }: { wait?: boolean } = {}
): Promise<{ transaction: Transaction; batches: number; total: number; warnings?: string }> {
  for (const c of contacts) {
    if (c.properties) assertSnakeCaseKeys(c.properties, "contact properties")
  }

  if (contacts.length > MAX_BATCH) {
    throw new Error(
      `Inflection accepts at most ${MAX_BATCH} contacts per batch; got ${contacts.length}. Split the file.`
    )
  }

  const { data, warnings } = await request(
    "/contacts/batch",
    { method: "POST", body: JSON.stringify({ contacts }) },
    "batch upsert contacts"
  )

  const pending = toTransaction(data)
  const transaction =
    wait && pending.transactionId
      ? await waitForTransaction(pending.transactionId)
      : pending

  return {
    transaction,
    batches: 1,
    total: contacts.length,
    ...(warnings ? { warnings } : {}),
  }
}

// ─── Lists and members ────────────────────────────────────────────────────────

export async function getList(id: string) {
  return request(`/lists/${encodeURIComponent(id)}`, {}, "get list")
}

export async function createList(name: string, description?: string) {
  return request(
    "/lists",
    {
      method: "POST",
      body: JSON.stringify({ name, ...(description ? { description } : {}) }),
    },
    "create list"
  )
}

export async function getListMembers(id: string, pageNumber?: number, pageSize?: number) {
  const params = new URLSearchParams()
  if (pageNumber !== undefined) params.set("pageNumber", String(pageNumber))
  if (pageSize !== undefined) params.set("pageSize", String(pageSize))
  const qs = params.toString()

  return request(
    `/lists/${encodeURIComponent(id)}/members${qs ? `?${qs}` : ""}`,
    {},
    "get list members"
  )
}

/**
 * Add contacts to a list by contact id — not by email.
 *
 * Unresolvable ids are skipped and reported in `errors` while the call still
 * returns 200, so the warnings from the envelope are the only signal that some
 * of them did not land.
 */
export async function addListMembers(id: string, contactIds: string[]) {
  return request(
    `/lists/${encodeURIComponent(id)}/members`,
    { method: "POST", body: JSON.stringify({ contactIds }) },
    "add list members"
  )
}

export async function removeListMember(id: string, contactId: string) {
  return request(
    `/lists/${encodeURIComponent(id)}/members/${encodeURIComponent(contactId)}`,
    { method: "DELETE" },
    "remove list member"
  )
}

// ─── Email ────────────────────────────────────────────────────────────────────

export async function getEmail(id: string) {
  return request(`/emails/${encodeURIComponent(id)}`, {}, "get email")
}

/** Cheapest authenticated read, for `agent:doctor`. */
export async function ping() {
  // A lookup for an address that will not exist: proves auth and routing without
  // writing anything. "Not found" is a successful authenticated round trip.
  try {
    await getContactByEmail("doctor-probe@moperator.invalid")
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith("Not found in Inflection")) return { ok: true }
    throw error
  }
}
