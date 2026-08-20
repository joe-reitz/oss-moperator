/**
 * HubSpot API Client
 *
 * Uses HubSpot REST API v3 with Private App token authentication.
 * Requires HUBSPOT_API_TOKEN.
 */

const BASE_URL = "https://api.hubapi.com"

function getToken(): string {
  const token = process.env.HUBSPOT_API_TOKEN
  if (!token) {
    throw new Error("HubSpot not configured. Set HUBSPOT_API_TOKEN.")
  }
  return token
}

async function hubspotFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HubSpot API error ${res.status}: ${body}`)
  }

  // DELETE returns 204 No Content
  if (res.status === 204) return { success: true }

  return res.json()
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function searchContacts(
  query: string,
  properties?: string[]
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      properties: properties || [
        "firstname",
        "lastname",
        "email",
        "company",
        "phone",
        "lifecyclestage",
      ],
      limit: 100,
    }),
  })
}

export async function getContact(
  id: string,
  properties?: string[]
): Promise<unknown> {
  const params = properties
    ? `?properties=${properties.join(",")}`
    : "?properties=firstname,lastname,email,company,phone,lifecyclestage"
  return hubspotFetch(`/crm/v3/objects/contacts/${id}${params}`)
}

export async function createContact(
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })
}

export async function updateContact(
  id: string,
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  })
}

export async function deleteContact(id: string): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/contacts/${id}`, {
    method: "DELETE",
  })
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function searchCompanies(
  query: string,
  properties?: string[]
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/companies/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      properties: properties || [
        "name",
        "domain",
        "industry",
        "city",
        "state",
        "numberofemployees",
      ],
      limit: 100,
    }),
  })
}

export async function getCompany(
  id: string,
  properties?: string[]
): Promise<unknown> {
  const params = properties
    ? `?properties=${properties.join(",")}`
    : "?properties=name,domain,industry,city,state,numberofemployees"
  return hubspotFetch(`/crm/v3/objects/companies/${id}${params}`)
}

export async function createCompany(
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })
}

export async function updateCompany(
  id: string,
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  })
}

// ─── Deals ────────────────────────────────────────────────────────────────────

export async function searchDeals(
  query: string,
  properties?: string[]
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/deals/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      properties: properties || [
        "dealname",
        "amount",
        "dealstage",
        "closedate",
        "pipeline",
        "hubspot_owner_id",
      ],
      limit: 100,
    }),
  })
}

export async function getDeal(
  id: string,
  properties?: string[]
): Promise<unknown> {
  const params = properties
    ? `?properties=${properties.join(",")}`
    : "?properties=dealname,amount,dealstage,closedate,pipeline,hubspot_owner_id"
  return hubspotFetch(`/crm/v3/objects/deals/${id}${params}`)
}

export async function createDeal(
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })
}

export async function updateDeal(
  id: string,
  properties: Record<string, string>
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/deals/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  })
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function getLists(): Promise<unknown> {
  return hubspotFetch("/crm/v3/lists")
}

export async function getListMembers(listId: string): Promise<unknown> {
  return hubspotFetch(`/crm/v3/lists/${listId}/memberships`)
}

export async function addToList(
  listId: string,
  recordIds: string[]
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/lists/${listId}/memberships/add`, {
    method: "PUT",
    body: JSON.stringify(recordIds),
  })
}

export async function removeFromList(
  listId: string,
  recordIds: string[]
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/lists/${listId}/memberships/remove`, {
    method: "PUT",
    body: JSON.stringify(recordIds),
  })
}

// ─── Owners ───────────────────────────────────────────────────────────────────

export async function listOwners(): Promise<unknown> {
  return hubspotFetch("/crm/v3/owners")
}
