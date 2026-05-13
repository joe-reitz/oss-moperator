/**
 * Luma Event API Client (single-calendar build)
 *
 * Creates events via Luma's public REST API with compliance registration
 * questions baked into every event.
 *
 * The internal Vercel build supports multiple regional calendars (apac /
 * community / global) with keyword-based routing. If you need that pattern,
 * look at the commit history of vercel/vercel-moperator for the original
 * LumaCalendar type and getConfig(calendar) implementation.
 */

import { randomUUID } from "crypto"
import { getRedis } from "@/lib/redis"
import { geocodeAddressParts } from "./geocode"
import type {
  CreateEventInput,
  CreateEventResult,
  LumaConfig,
  PendingLumaEvent,
  RegistrationQuestion,
} from "./types"

const PENDING_KEY_PREFIX = "moperator:luma_pending:"
const PENDING_TTL = 1800 // 30 minutes
const CALENDAR_META_KEY = "moperator:luma:calendar_meta"
const CALENDAR_META_TTL = 60 * 60 * 24

function getConfig(): LumaConfig {
  const apiKey = process.env.LUMA_API_KEY
  if (!apiKey) {
    throw new Error("LUMA_API_KEY environment variable is not set")
  }
  return { apiKey, baseUrl: "https://public-api.luma.com" }
}

interface LumaCalendarMeta {
  id: string
  name: string
  avatar_url: string | null
  cover_image_url: string | null
}

async function getCalendarMeta(): Promise<LumaCalendarMeta | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get<string | LumaCalendarMeta>(CALENDAR_META_KEY)
      if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached
    } catch {
      // fall through
    }
  }

  const config = getConfig()
  const response = await fetch(`${config.baseUrl}/v1/calendar/get`, {
    headers: { "x-luma-api-key": config.apiKey },
  })
  if (!response.ok) {
    console.warn(`[Luma] Failed to fetch calendar meta: ${response.status}`)
    return null
  }
  const data = await response.json()
  const cal = data.calendar || data
  const meta: LumaCalendarMeta = {
    id: cal.id,
    name: cal.name,
    avatar_url: cal.avatar_url ?? null,
    cover_image_url: cal.cover_image_url ?? null,
  }
  if (redis) {
    redis.set(CALENDAR_META_KEY, JSON.stringify(meta), { ex: CALENDAR_META_TTL }).catch(() => {})
  }
  return meta
}

async function getDefaultCoverUrl(): Promise<string | undefined> {
  const override = process.env.LUMA_DEFAULT_COVER_URL
  if (override) return override
  try {
    const meta = await getCalendarMeta()
    return meta?.avatar_url || meta?.cover_image_url || undefined
  } catch (err) {
    console.warn(`[Luma] Default cover lookup failed:`, err)
    return undefined
  }
}

/**
 * Compliance registration questions injected into every Luma event.
 * Edit these for your org's compliance requirements; the structure
 * mirrors Luma's public API.
 */
export const COMPLIANCE_REGISTRATION_QUESTIONS: RegistrationQuestion[] = [
  {
    id: "company",
    label: "Company",
    required: true,
    question_type: "company",
    collect_job_title: true,
  },
  {
    id: "country",
    label: "Country",
    required: true,
    question_type: "dropdown",
    options: [
      "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
      "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
      "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
      "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
      "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
      "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
      "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
      "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
      "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
      "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
      "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
      "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
      "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
      "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait",
      "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
      "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia",
      "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius",
      "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
      "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand",
      "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
      "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay",
      "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia",
      "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
      "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal",
      "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
      "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan",
      "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
      "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga",
      "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda",
      "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
      "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
      "Zambia", "Zimbabwe",
    ],
  },
  {
    id: "marketing_opt_in",
    label: "I agree to receive marketing communications. You can unsubscribe at any time.",
    required: false,
    question_type: "agree-check",
  },
]

/**
 * Optional data-sharing opt-in question. Added when the event has named
 * partners/sponsors so attendees can opt in to having their registration
 * shared with those orgs.
 */
export const PARTNER_DATA_SHARING_QUESTION: RegistrationQuestion = {
  id: "partner_data_sharing_opt_in",
  label:
    "Yes, I consent to my event registration details (e.g. name, email address, company name) being shared with event sponsors listed on this registration page. Sponsors may contact me for their own marketing purposes in accordance with their privacy policies.",
  required: false,
  question_type: "agree-check",
}

// ─── Pending Event Storage (Redis — confirmation card pattern) ──────────────

export async function storePendingLumaEvent(
  params: Omit<PendingLumaEvent, "id" | "createdAt">
): Promise<string> {
  const redis = getRedis()
  if (!redis) throw new Error("Redis not configured")

  const id = randomUUID()
  const pending: PendingLumaEvent = { ...params, id, createdAt: Date.now() }

  await redis.set(`${PENDING_KEY_PREFIX}${id}`, JSON.stringify(pending), { ex: PENDING_TTL })
  return id
}

export async function getPendingLumaEvent(id: string): Promise<PendingLumaEvent | null> {
  const redis = getRedis()
  if (!redis) return null

  const data = await redis.get<string>(`${PENDING_KEY_PREFIX}${id}`)
  if (!data) return null

  return typeof data === "string" ? JSON.parse(data) : (data as unknown as PendingLumaEvent)
}

export async function clearPendingLumaEvent(id: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(`${PENDING_KEY_PREFIX}${id}`)
}

/**
 * Create a Luma event with compliance registration questions.
 */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const config = getConfig()

  const hasPartners = (input.partners?.length ?? 0) > 0
  const allQuestions = [
    ...input.registration_questions,
    ...COMPLIANCE_REGISTRATION_QUESTIONS,
    ...(hasPartners ? [PARTNER_DATA_SHARING_QUESTION] : []),
  ]

  const toUTC = (localIso: string, tz: string): string => {
    try {
      const utcDate = new Date(localIso + "Z")
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      })
      const parts = formatter.formatToParts(utcDate)
      const get = (type: string) => parts.find(p => p.type === type)?.value || "0"
      const tzYear = parseInt(get("year"))
      const tzMonth = parseInt(get("month"))
      const tzDay = parseInt(get("day"))
      const tzHour = parseInt(get("hour"))
      const tzMinute = parseInt(get("minute"))

      const localDate = new Date(localIso)
      const localMs = Date.UTC(
        localDate.getFullYear(), localDate.getMonth(), localDate.getDate(),
        localDate.getHours(), localDate.getMinutes(), localDate.getSeconds()
      )
      const tzMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, parseInt(get("second")))
      const offsetMs = tzMs - utcDate.getTime()

      const actualUtc = new Date(localMs - offsetMs)
      return actualUtc.toISOString()
    } catch {
      return localIso.endsWith("Z") ? localIso : localIso + "Z"
    }
  }

  const startUtc = toUTC(input.start_at, input.timezone)
  const endUtc = toUTC(input.end_at, input.timezone)

  const description = input.description || ""

  const body: Record<string, unknown> = {
    name: input.name,
    start_at: startUtc,
    end_at: endUtc,
    timezone: input.timezone,
    duration_interval: input.duration_interval,
    description_md: description,
    visibility: input.visibility,
    tint_color: "#000000",
    registration_questions: allQuestions,
  }
  if (input.meeting_url) body.meeting_url = input.meeting_url
  const coverUrl = input.cover_url || (await getDefaultCoverUrl())
  if (coverUrl) body.cover_url = coverUrl

  if (input.geo_address_json) {
    const g = input.geo_address_json
    const locationParts = [g.address, g.city, g.region, g.country].filter(Boolean)
    if (locationParts.length > 0) {
      const fullAddress = locationParts.join(", ")
      const geocoded = await geocodeAddressParts({
        address: g.address,
        city: g.city,
        region: g.region,
        country: g.country,
      })
      if (geocoded) {
        body.geo_address_json = {
          type: "manual",
          address: g.address || "",
          city: g.city || "",
          region: g.region || "",
          country: g.country || "",
          full_address: fullAddress,
        }
        body.coordinate = {
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
        }
      } else {
        body.geo_address_json = {
          type: "manual",
          address: g.address || "",
          city: g.city || "",
          region: g.region || "",
          country: g.country || "",
          full_address: fullAddress,
        }
      }
    }
  }

  const response = await fetch(`${config.baseUrl}/v1/event/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-luma-api-key": config.apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Luma API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const event = data.event || data
  const eventId = event.api_id || event.id

  let url = event.url || `https://lu.ma/${eventId}`
  try {
    const getRes = await fetch(`${config.baseUrl}/v1/event/get?id=${eventId}`, {
      headers: { "x-luma-api-key": config.apiKey },
    })
    if (getRes.ok) {
      const getData = await getRes.json()
      const fetched = getData.event || getData
      url = fetched.url || url
    }
  } catch (e) {
    console.error("[Luma] Failed to fetch event after creation:", e)
  }

  if (input.require_rsvp_approval) {
    try {
      await setTicketTypesRequireApproval(eventId, true)
    } catch (e) {
      console.error("[Luma] Failed to set require_approval on default ticket:", e)
    }
  }

  return {
    event_id: eventId,
    url,
    manage_url: `https://lu.ma/event/manage/${eventId}`,
    name: input.name,
  }
}

/**
 * Flip require_approval on every ticket type for an event.
 * Luma auto-creates a free "Standard" ticket type when none are explicit;
 * the Require Approval toggle in the Luma UI lives on the ticket type,
 * not the event.
 */
export async function setTicketTypesRequireApproval(
  eventId: string,
  requireApproval: boolean
): Promise<void> {
  const config = getConfig()

  const listRes = await fetch(
    `${config.baseUrl}/v1/event/ticket-types/list?event_id=${encodeURIComponent(eventId)}&include_hidden=true`,
    { headers: { "x-luma-api-key": config.apiKey } }
  )
  if (!listRes.ok) {
    const errorText = await listRes.text()
    throw new Error(`Luma ticket-types/list error (${listRes.status}): ${errorText}`)
  }
  const listData = await listRes.json()
  const ticketTypes: Array<Record<string, unknown>> =
    listData.entries || listData.ticket_types || []

  if (ticketTypes.length === 0) {
    console.warn(`[Luma] No ticket types found for event ${eventId} — skipping require_approval update`)
    return
  }

  for (const tt of ticketTypes) {
    const ticketTypeId = (tt.api_id || tt.id) as string | undefined
    if (!ticketTypeId) continue

    const updateRes = await fetch(`${config.baseUrl}/v1/event/ticket-types/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-luma-api-key": config.apiKey,
      },
      body: JSON.stringify({
        event_ticket_type_id: ticketTypeId,
        require_approval: requireApproval,
      }),
    })
    if (!updateRes.ok) {
      const errorText = await updateRes.text()
      throw new Error(`Luma ticket-types/update error (${updateRes.status}) for ${ticketTypeId}: ${errorText}`)
    }
  }
}

/**
 * Stamp the Luma event ID onto a Salesforce Campaign record.
 *
 * Field name is configurable via `SFDC_CAMPAIGN_LUMA_EVENT_FIELD` so you
 * can point at whatever custom field your org has set up without a code
 * change. Defaults to `Luma_Event_Id__c`.
 */
export async function updateSfdcCampaignWithLumaEvent(
  campaignId: string,
  lumaEventId: string
): Promise<{ field: string }> {
  const field = process.env.SFDC_CAMPAIGN_LUMA_EVENT_FIELD || "Luma_Event_Id__c"
  const { updateRecord } = await import("@/lib/integrations/salesforce/client")
  await updateRecord("Campaign", campaignId, { [field]: lumaEventId })
  return { field }
}

/**
 * Extract a Luma slug or event ID from whatever the user pasted.
 * Accepts full lu.ma / luma.com URLs (with or without /event/ prefix),
 * with or without query strings or trailing slashes, plus bare slugs.
 */
export function extractLumaEventId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const stripped = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")

  const match = stripped.match(/^(?:lu\.ma|luma\.com)\/(?:event\/(?:manage\/)?)?([\w-]+)/i)
  if (match) return match[1]

  if (/^[\w-]+$/.test(stripped)) return stripped

  return null
}

const RESOLVE_CACHE_PREFIX = "moperator:luma_event_resolve:"
const RESOLVE_CACHE_TTL = 7 * 24 * 60 * 60

/**
 * Convert a Luma URL slug (e.g. `fqriyw5v`) to the canonical event API
 * ID (`evt-XYZ`). Already-canonical inputs short-circuit. Strategy: scrape
 * the public event page HTML, where Luma's Next.js app inlines the
 * event's api_id multiple times. Cached in Redis for a week.
 *
 * Why not Luma's documented lookup endpoint: that only matches events
 * submitted to the calendar tied to your API key. It misses events
 * created outside that calendar — which is most field events.
 *
 * Returns null when the page can't be fetched or doesn't expose an
 * evt- ID (deleted event, private-without-link sharing, future Luma
 * markup changes).
 */
export async function resolveLumaEventApiId(slugOrApiId: string): Promise<string | null> {
  if (/^evt-[\w-]+$/i.test(slugOrApiId)) return slugOrApiId

  const redis = getRedis()
  const cacheKey = `${RESOLVE_CACHE_PREFIX}${slugOrApiId}`

  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey)
      if (typeof cached === "string" && cached.toLowerCase().startsWith("evt-")) {
        return cached
      }
    } catch {
      // fall through
    }
  }

  const apiId = await scrapeLumaEventApiId(slugOrApiId)
  if (apiId && redis) {
    redis.set(cacheKey, apiId, { ex: RESOLVE_CACHE_TTL }).catch(() => {})
  }
  return apiId
}

async function scrapeLumaEventApiId(slug: string): Promise<string | null> {
  const candidates = [`https://luma.com/${slug}`, `https://lu.ma/${slug}`]

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      })
      if (!res.ok) {
        if (res.status !== 404) {
          console.warn(`[Luma] page fetch ${url} returned ${res.status}`)
        }
        continue
      }
      const html = await res.text()
      const matches = html.match(/evt-[A-Za-z0-9]{8,}/g)
      if (!matches || matches.length === 0) continue

      const counts = new Map<string, number>()
      for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1)
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const apiId = sorted[0]?.[0]
      if (apiId) return apiId
    } catch (err) {
      console.warn(
        `[Luma] page fetch failed for ${url}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return null
}

/**
 * Update an existing Luma event's visibility.
 */
export async function updateEventVisibility(
  eventId: string,
  visibility: "public" | "private" | "members-only"
): Promise<void> {
  const config = getConfig()
  const response = await fetch(`${config.baseUrl}/v1/event/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-luma-api-key": config.apiKey,
    },
    body: JSON.stringify({ event_id: eventId, visibility }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Luma update error (${response.status}): ${errorText}`)
  }
}

/**
 * Add a host/manager to a Luma event.
 */
export async function addHost(eventId: string, email: string, name?: string): Promise<void> {
  const config = getConfig()

  const response = await fetch(`${config.baseUrl}/v1/event/add-host`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-luma-api-key": config.apiKey,
    },
    body: JSON.stringify({
      event_api_id: eventId,
      email,
      name: name || "",
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Luma add-host error (${response.status}): ${errorText}`)
  }
}
