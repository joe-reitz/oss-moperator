/**
 * Luma Event API Types
 *
 * Single-calendar build. The internal Vercel version supports multiple
 * regional calendars (apac / community / global) — see commit history of
 * vercel/vercel-moperator for that pattern if you want to extend.
 */

export interface LumaConfig {
  apiKey: string
  baseUrl: string
}

export interface GeoAddress {
  address?: string
  city?: string
  region?: string
  country?: string
}

export interface RegistrationQuestion {
  id: string
  label: string
  required: boolean
  question_type: string
  collect_job_title?: boolean
  job_title_label?: string
  options?: string[]
  description?: string
  terms?: {
    content_type: "text" | "link"
    content_md?: string
    url?: string
    collect_signature?: boolean
  }
}

export interface CreateEventInput {
  name: string
  start_at: string
  end_at: string
  timezone: string
  duration_interval: string
  description?: string
  geo_address_json?: GeoAddress | null
  meeting_url?: string
  cover_url?: string
  visibility: "public" | "private"
  registration_questions: RegistrationQuestion[]
  require_rsvp_approval: boolean
  /** Names of partners/sponsors. Non-empty list adds a data-sharing opt-in checkbox. */
  partners?: string[]
}

export interface CreateEventResult {
  event_id: string
  url: string
  manage_url: string
  name: string
}

export interface PendingLumaEvent {
  id: string
  name: string
  start_at: string
  end_at: string
  timezone: string
  duration_interval: string
  description?: string
  geo_address_json?: GeoAddress | null
  meeting_url?: string
  cover_url?: string
  visibility: "public" | "private"
  require_rsvp_approval: boolean
  partners?: string[]
  sfdcCampaignId?: string
  requesterId: string
  channelId: string
  threadTs: string
  createdAt: number
}
