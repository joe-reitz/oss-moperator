/**
 * Marketo REST API Client
 *
 * Uses OAuth 2.0 client credentials for authentication with auto-refresh.
 * Requires MARKETO_CLIENT_ID, MARKETO_CLIENT_SECRET, MARKETO_REST_ENDPOINT.
 */

let _accessToken: string | null = null
let _tokenExpiresAt = 0

function getConfig() {
  const clientId = process.env.MARKETO_CLIENT_ID
  const clientSecret = process.env.MARKETO_CLIENT_SECRET
  const restEndpoint = process.env.MARKETO_REST_ENDPOINT

  if (!clientId || !clientSecret || !restEndpoint) {
    throw new Error(
      "Marketo not configured. Set MARKETO_CLIENT_ID, MARKETO_CLIENT_SECRET, and MARKETO_REST_ENDPOINT."
    )
  }

  // Strip trailing slash
  const baseUrl = restEndpoint.replace(/\/+$/, "")

  return { clientId, clientSecret, baseUrl }
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (_accessToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _accessToken
  }

  const { clientId, clientSecret, baseUrl } = getConfig()

  const res = await fetch(
    `${baseUrl}/identity/oauth/token?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
    { method: "POST" }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Marketo auth error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
  }

  _accessToken = data.access_token
  _tokenExpiresAt = Date.now() + data.expires_in * 1000

  return _accessToken
}

async function marketoFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const token = await getAccessToken()
  const { baseUrl } = getConfig()

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Marketo API error ${res.status}: ${body}`)
  }

  return res.json()
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function getLeads(
  filterType: string,
  filterValues: string[]
): Promise<unknown> {
  const params = new URLSearchParams({
    filterType,
    filterValues: filterValues.join(","),
  })
  return marketoFetch(`/rest/v1/leads.json?${params}`)
}

export async function getLead(id: string): Promise<unknown> {
  return marketoFetch(`/rest/v1/lead/${id}.json`)
}

export async function createOrUpdateLeads(
  leads: Array<Record<string, unknown>>,
  action: "createOnly" | "updateOnly" | "createOrUpdate" = "createOrUpdate"
): Promise<unknown> {
  return marketoFetch("/rest/v1/leads.json", {
    method: "POST",
    body: JSON.stringify({
      action,
      input: leads,
    }),
  })
}

export async function deleteLead(id: string): Promise<unknown> {
  return marketoFetch("/rest/v1/leads/delete.json", {
    method: "POST",
    body: JSON.stringify({
      input: [{ id }],
    }),
  })
}

export async function describeLeads(): Promise<unknown> {
  return marketoFetch("/rest/v1/leads/describe.json")
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function getLists(): Promise<unknown> {
  return marketoFetch("/rest/v1/lists.json")
}

export async function getListLeads(listId: string): Promise<unknown> {
  return marketoFetch(`/rest/v1/lists/${listId}/leads.json`)
}

export async function addLeadsToList(
  listId: string,
  leadIds: string[]
): Promise<unknown> {
  const params = new URLSearchParams({ id: leadIds.join(",") })
  return marketoFetch(`/rest/v1/lists/${listId}/leads.json?${params}`, {
    method: "POST",
  })
}

export async function removeLeadsFromList(
  listId: string,
  leadIds: string[]
): Promise<unknown> {
  const params = new URLSearchParams({ id: leadIds.join(",") })
  return marketoFetch(`/rest/v1/lists/${listId}/leads.json?${params}`, {
    method: "DELETE",
  })
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<unknown> {
  return marketoFetch("/rest/v1/campaigns.json")
}

export async function triggerCampaign(
  campaignId: string,
  leadIds: string[],
  tokens?: Array<{ name: string; value: string }>
): Promise<unknown> {
  const body: Record<string, unknown> = {
    input: { leads: leadIds.map((id) => ({ id })) },
  }
  if (tokens) {
    body.input = {
      ...(body.input as Record<string, unknown>),
      tokens,
    }
  }
  return marketoFetch(`/rest/v1/campaigns/${campaignId}/trigger.json`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export async function getPrograms(): Promise<unknown> {
  return marketoFetch("/rest/asset/v1/programs.json")
}

export async function getEmails(): Promise<unknown> {
  return marketoFetch("/rest/asset/v1/emails.json")
}

export async function getFolders(): Promise<unknown> {
  return marketoFetch("/rest/asset/v1/folders.json")
}
