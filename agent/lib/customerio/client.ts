/**
 * Customer.io client.
 *
 * Customer.io is two APIs with two different credentials, and conflating them is
 * the single most common setup mistake:
 *
 *   - **App API** (`api.customer.io/v1`, Bearer app key) reads people, segments,
 *     campaigns and broadcasts, and sends transactional email.
 *   - **Track API** (`track.customer.io/api/v1`, HTTP Basic site_id:track_key)
 *     writes people, records events, and manages *manual* segment membership.
 *
 * Only the App API key is required. The Track credentials are optional, and the
 * functions that need them throw a message naming exactly what is missing rather
 * than failing as a 401 — an unset credential should not look like a bad one.
 *
 * Both APIs are region-locked. A US key against the EU host returns 401, which
 * reads as "wrong key" when it actually means "wrong region", so
 * CUSTOMERIO_REGION picks the host pair.
 */

const RATE_LIMIT_NOTE =
  "Customer.io rate limits: 10 req/s for most endpoints, 100/s for transactional email, and 1 per 10s for broadcast triggers."

function region(): "us" | "eu" {
  return (process.env.CUSTOMERIO_REGION || "us").trim().toLowerCase() === "eu"
    ? "eu"
    : "us"
}

function appBase(): string {
  return region() === "eu"
    ? "https://api-eu.customer.io/v1"
    : "https://api.customer.io/v1"
}

function trackBase(): string {
  return region() === "eu"
    ? "https://track-eu.customer.io/api/v1"
    : "https://track.customer.io/api/v1"
}

function appKey(): string {
  const key = process.env.CUSTOMERIO_APP_API_KEY
  if (!key) {
    throw new Error(
      "Customer.io App API not configured. Set CUSTOMERIO_APP_API_KEY."
    )
  }
  return key
}

/**
 * Track credentials are optional, so this names both variables when either is
 * missing. Writes and event tracking are unavailable without them.
 */
function trackAuth(): string {
  const siteId = process.env.CUSTOMERIO_SITE_ID
  const trackKey = process.env.CUSTOMERIO_TRACK_API_KEY
  if (!siteId || !trackKey) {
    throw new Error(
      "This needs the Customer.io Track API, which is a separate credential from the App API key. Set CUSTOMERIO_SITE_ID and CUSTOMERIO_TRACK_API_KEY (Workspace Settings → API Credentials → Tracking API Keys)."
    )
  }
  return Buffer.from(`${siteId}:${trackKey}`).toString("base64")
}

async function appFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${appBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${appKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) {
      throw new Error(
        `Customer.io App API 401. Check CUSTOMERIO_APP_API_KEY, and that CUSTOMERIO_REGION matches the workspace (currently "${region()}") — a key from the other region also returns 401.`
      )
    }
    if (res.status === 429) {
      throw new Error(`Customer.io App API 429 (rate limited). ${RATE_LIMIT_NOTE}`)
    }
    throw new Error(`Customer.io App API error ${res.status}: ${body}`)
  }

  // 204 on some writes.
  const text = await res.text()
  return text ? JSON.parse(text) : { ok: true }
}

async function trackFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${trackBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${trackAuth()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) {
      throw new Error(
        `Customer.io Track API 401. Check CUSTOMERIO_SITE_ID and CUSTOMERIO_TRACK_API_KEY, and that CUSTOMERIO_REGION matches the workspace (currently "${region()}").`
      )
    }
    throw new Error(`Customer.io Track API error ${res.status}: ${body}`)
  }

  const text = await res.text()
  return text ? JSON.parse(text) : { ok: true }
}

// ─── People (App API — read) ──────────────────────────────────────────────────

/**
 * Look someone up by email.
 *
 * Customer.io returns 200 with an empty result for a badly encoded address
 * rather than an error, so the email is encoded here and an empty match is
 * reported as such — otherwise "not found" and "you sent a malformed query"
 * are indistinguishable.
 */
export async function getPersonByEmail(email: string): Promise<unknown> {
  return appFetch(`/customers?email=${encodeURIComponent(email)}`)
}

export async function searchPeople(
  filter: unknown,
  limit = 50
): Promise<unknown> {
  return appFetch(`/customers?limit=${limit}`, {
    method: "POST",
    body: JSON.stringify({ filter }),
  })
}

// ─── Segments ─────────────────────────────────────────────────────────────────

export async function listSegments(): Promise<unknown> {
  return appFetch("/segments")
}

export async function getSegmentMembership(
  segmentId: string,
  limit = 100
): Promise<unknown> {
  return appFetch(
    `/segments/${encodeURIComponent(segmentId)}/membership?limit=${limit}`
  )
}

/**
 * Manual segment membership is a Track API operation, not App API — a detail
 * that sends people hunting through the wrong reference.
 *
 * Only *manual* segments accept this. Data-driven segments compute their own
 * membership and Customer.io rejects the call.
 */
export async function addToSegment(
  segmentId: string,
  customerIds: string[]
): Promise<unknown> {
  return trackFetch(`/segments/${encodeURIComponent(segmentId)}/add_customers`, {
    method: "POST",
    body: JSON.stringify({ ids: customerIds }),
  })
}

export async function removeFromSegment(
  segmentId: string,
  customerIds: string[]
): Promise<unknown> {
  return trackFetch(
    `/segments/${encodeURIComponent(segmentId)}/remove_customers`,
    { method: "POST", body: JSON.stringify({ ids: customerIds }) }
  )
}

// ─── Campaigns and broadcasts (App API — read) ────────────────────────────────

export async function listCampaigns(): Promise<unknown> {
  return appFetch("/campaigns")
}

export async function getCampaignMetrics(
  campaignId: string,
  period = "days",
  steps = 30
): Promise<unknown> {
  return appFetch(
    `/campaigns/${encodeURIComponent(campaignId)}/metrics?period=${period}&steps=${steps}`
  )
}

export async function listBroadcasts(): Promise<unknown> {
  return appFetch("/broadcasts")
}

// ─── People (Track API — write) ───────────────────────────────────────────────

/**
 * Create or update a person. Upsert by identifier.
 *
 * Customer.io has no separate create; a PUT to an unknown id creates. That means
 * a typo in the identifier silently makes a new person rather than erroring,
 * which is worth knowing before bulk-writing.
 */
export async function identifyPerson(
  identifier: string,
  attributes: Record<string, unknown>
): Promise<unknown> {
  return trackFetch(`/customers/${encodeURIComponent(identifier)}`, {
    method: "PUT",
    body: JSON.stringify(attributes),
  })
}

export async function trackEvent(
  identifier: string,
  name: string,
  data?: Record<string, unknown>
): Promise<unknown> {
  return trackFetch(`/customers/${encodeURIComponent(identifier)}/events`, {
    method: "POST",
    body: JSON.stringify({ name, ...(data ? { data } : {}) }),
  })
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/**
 * Send one transactional email.
 *
 * `transactional_message_id` points at a transactional message configured in
 * Customer.io; this does not compose a message from scratch. `message_data`
 * fills that template's liquid variables.
 */
export async function sendTransactionalEmail(input: {
  transactionalMessageId: string | number
  to: string
  identifiers: Record<string, string>
  messageData?: Record<string, unknown>
}): Promise<unknown> {
  return appFetch("/send/email", {
    method: "POST",
    body: JSON.stringify({
      transactional_message_id: input.transactionalMessageId,
      to: input.to,
      identifiers: input.identifiers,
      ...(input.messageData ? { message_data: input.messageData } : {}),
    }),
  })
}

/**
 * Fire an API-triggered broadcast — this sends to a whole audience.
 *
 * Rate-limited by Customer.io to one call every 10 seconds, which is a useful
 * accident-limiter but not a safety net: one call can reach everyone in the
 * broadcast's segment.
 */
export async function triggerBroadcast(
  broadcastId: string,
  input: {
    segmentId?: string
    emails?: string[]
    data?: Record<string, unknown>
  } = {}
): Promise<unknown> {
  const body: Record<string, unknown> = {}
  if (input.segmentId) body.segment_id = input.segmentId
  if (input.emails?.length) body.emails = input.emails
  if (input.data) body.data = input.data

  return appFetch(`/campaigns/${encodeURIComponent(broadcastId)}/triggers`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** Cheapest authenticated read, for `agent:doctor`. */
export async function ping(): Promise<unknown> {
  return appFetch("/segments")
}
