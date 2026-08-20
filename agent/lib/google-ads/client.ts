/**
 * Google Ads REST API Client + OAuth 2.0 Authentication
 *
 * Uses the Google Ads REST API (v17) with GAQL for queries.
 * Auth: OAuth 2.0 access token + developer-token header.
 * Tokens cached in Redis with auto-refresh on expiry.
 * Docs: https://developers.google.com/google-ads/api/rest/overview
 */

import { getRedis } from "../redis"
import { createLogger } from "../logger"
import crypto from "crypto"

const log = createLogger("GoogleAds")

// =============================================================================
// Constants
// =============================================================================

const API_VERSION = "v17"
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

const REDIS_TOKEN_KEY = "moperator:google-ads:access_token"
const REDIS_REFRESH_KEY = "moperator:google-ads:refresh_token"
const REDIS_TOKEN_TTL = 3000 // 50 minutes — Google tokens expire in 60min
const REDIS_STATE_PREFIX = "moperator:google-ads:oauth-state:"
const REDIS_STATE_TTL = 600 // 10 minutes for OAuth flow

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SCOPES = "https://www.googleapis.com/auth/adwords"

// =============================================================================
// OAuth Flow
// =============================================================================

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET are required")
  }
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/google-ads/callback`
  return { clientId, clientSecret, redirectUri }
}

export function getAuthorizationUrl(): string {
  const { clientId, redirectUri } = getOAuthConfig()
  const state = crypto.randomBytes(16).toString("hex")

  // Store state in Redis for CSRF validation
  const redis = getRedis()
  if (redis) {
    redis.set(`${REDIS_STATE_PREFIX}${state}`, "1", { ex: REDIS_STATE_TTL }).catch(() => {})
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  })

  return `${AUTH_URL}?${params.toString()}`
}

export async function validateState(state: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true // Skip validation without Redis
  const key = `${REDIS_STATE_PREFIX}${state}`
  const exists = await redis.get(key)
  if (exists) {
    await redis.del(key)
    return true
  }
  return false
}

interface GoogleTokens {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig()

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })

  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || res.statusText}`)
  }

  const tokens: GoogleTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }

  // Cache tokens
  await cacheTokens(tokens)
  log.info("Token exchange successful")

  return tokens
}

async function cacheTokens(tokens: GoogleTokens): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  await Promise.all([
    redis.set(REDIS_TOKEN_KEY, tokens.accessToken, { ex: REDIS_TOKEN_TTL }),
    tokens.refreshToken
      ? redis.set(REDIS_REFRESH_KEY, tokens.refreshToken)
      : Promise.resolve(),
  ])
}

// =============================================================================
// Token Management
// =============================================================================

async function getRefreshToken(): Promise<string | null> {
  const redis = getRedis()
  if (redis) {
    const cached = await redis.get<string>(REDIS_REFRESH_KEY)
    if (cached) return cached
  }
  return process.env.GOOGLE_ADS_REFRESH_TOKEN || null
}

export async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) {
    throw new Error("No refresh token available. Run the OAuth flow: /api/integrations/google-ads")
  }

  const { clientId, clientSecret } = getOAuthConfig()

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  })

  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`)
  }

  const accessToken = data.access_token as string

  // Cache the new access token
  const redis = getRedis()
  if (redis) {
    await redis.set(REDIS_TOKEN_KEY, accessToken, { ex: REDIS_TOKEN_TTL })
  }

  log.info("Access token refreshed")
  return accessToken
}

/**
 * Get a valid access token. Priority: Redis cache -> env var -> refresh.
 */
export async function getAccessToken(): Promise<string> {
  // 1. Redis cache
  const redis = getRedis()
  if (redis) {
    const cached = await redis.get<string>(REDIS_TOKEN_KEY)
    if (cached) return cached
  }

  // 2. Env var (bootstrap)
  if (process.env.GOOGLE_ADS_ACCESS_TOKEN) {
    return process.env.GOOGLE_ADS_ACCESS_TOKEN
  }

  // 3. Refresh
  return refreshAccessToken()
}

/**
 * Clear token cache — call on 401 before retrying.
 */
export async function clearTokenCache(): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redis.del(REDIS_TOKEN_KEY)
  }
}

// =============================================================================
// API Config & Helpers
// =============================================================================

function getConfig() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID

  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured")
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured")

  return { developerToken, customerId, loginCustomerId }
}

function getBaseUrl(customerId: string): string {
  return `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}`
}

async function getHeaders(): Promise<Record<string, string>> {
  const { developerToken, loginCustomerId } = getConfig()
  const accessToken = await getAccessToken()

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  }

  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId
  }

  return headers
}

// =============================================================================
// REST API: Search & Mutate
// =============================================================================

interface GoogleAdsMutateResult {
  results: Array<{ resourceName: string }>
}

/**
 * Execute a GAQL query against the Google Ads SearchStream endpoint.
 */
export async function search(gaql: string): Promise<Record<string, unknown>[]> {
  const { customerId } = getConfig()
  const url = `${getBaseUrl(customerId)}/googleAds:searchStream`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headers = await getHeaders()

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: gaql }),
    })

    // Rate limit retry
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500
      log.info(`Rate limited, retrying in ${Math.round(delay)}ms`)
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    // Auth error — refresh token and retry once
    if (res.status === 401 && attempt === 0) {
      log.info("401 — clearing token cache and retrying")
      await clearTokenCache()
      continue
    }

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google Ads API error (${res.status}): ${errText.slice(0, 500)}`)
    }

    const data = await res.json()
    // SearchStream returns an array of batches, each with a results array
    const allResults: Record<string, unknown>[] = []
    if (Array.isArray(data)) {
      for (const batch of data) {
        if (batch.results) {
          allResults.push(...batch.results)
        }
      }
    }
    return allResults
  }

  throw new Error("Max retries exceeded for Google Ads search")
}

/**
 * Execute a mutate operation (create, update, delete).
 */
export async function mutate(
  resource: string,
  operations: Record<string, unknown>[]
): Promise<GoogleAdsMutateResult> {
  const { customerId } = getConfig()
  const url = `${getBaseUrl(customerId)}/${resource}:mutate`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headers = await getHeaders()

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ operations }),
    })

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    if (res.status === 401 && attempt === 0) {
      await clearTokenCache()
      continue
    }

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google Ads mutate error (${res.status}): ${errText.slice(0, 500)}`)
    }

    return res.json()
  }

  throw new Error("Max retries exceeded for Google Ads mutate")
}

// =============================================================================
// High-level Helpers
// =============================================================================

export async function listCampaigns(): Promise<Record<string, unknown>[]> {
  return search(`
    SELECT
      campaign.id, campaign.name, campaign.status,
      campaign.advertising_channel_type, campaign.start_date, campaign.end_date,
      campaign_budget.amount_micros, campaign_budget.delivery_method,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `)
}

export async function getCampaign(campaignId: string): Promise<Record<string, unknown> | null> {
  const results = await search(`
    SELECT
      campaign.id, campaign.name, campaign.status,
      campaign.advertising_channel_type, campaign.start_date, campaign.end_date,
      campaign_budget.amount_micros, campaign_budget.delivery_method,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE campaign.id = ${campaignId}
  `)
  return results[0] || null
}

export async function getCampaignPerformance(
  campaignId: string | undefined,
  dateRange: string
): Promise<Record<string, unknown>[]> {
  const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : ""
  return search(`
    SELECT
      campaign.id, campaign.name,
      segments.date,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.ctr, metrics.average_cpc,
      metrics.all_conversions_value
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      ${campaignFilter}
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date DESC
  `)
}

export async function createCampaignBudget(
  dailyBudgetMicros: number
): Promise<string> {
  const result = await mutate("campaignBudgets", [{
    create: {
      name: `Budget_${Date.now()}`,
      amountMicros: String(dailyBudgetMicros),
      deliveryMethod: "STANDARD",
    },
  }])
  return result.results[0].resourceName
}

export async function createCampaign(opts: {
  name: string
  budgetResourceName: string
  channelType: string
  status?: string
}): Promise<string> {
  const result = await mutate("campaigns", [{
    create: {
      name: opts.name,
      advertisingChannelType: opts.channelType,
      status: opts.status || "PAUSED",
      campaignBudget: opts.budgetResourceName,
      manualCpc: {},
    },
  }])
  return result.results[0].resourceName
}

export async function updateCampaignBudget(
  budgetResourceName: string,
  dailyBudgetMicros: number
): Promise<void> {
  await mutate("campaignBudgets", [{
    update: {
      resourceName: budgetResourceName,
      amountMicros: String(dailyBudgetMicros),
    },
    updateMask: "amount_micros",
  }])
}

export async function createAdGroup(opts: {
  campaignId: string
  name: string
  cpcBidMicros?: number
}): Promise<string> {
  const { customerId } = getConfig()
  const result = await mutate("adGroups", [{
    create: {
      name: opts.name,
      campaign: `customers/${customerId}/campaigns/${opts.campaignId}`,
      status: "ENABLED",
      type: "SEARCH_STANDARD",
      ...(opts.cpcBidMicros ? { cpcBidMicros: String(opts.cpcBidMicros) } : {}),
    },
  }])
  return result.results[0].resourceName
}

export async function createResponsiveSearchAd(opts: {
  adGroupResourceName: string
  headlines: string[]    // 3-15 headlines, max 30 chars each
  descriptions: string[] // 2-4 descriptions, max 90 chars each
  finalUrl: string
  path1?: string         // max 15 chars
  path2?: string         // max 15 chars
}): Promise<string> {
  const result = await mutate("adGroupAds", [{
    create: {
      adGroup: opts.adGroupResourceName,
      status: "ENABLED",
      ad: {
        responsiveSearchAd: {
          headlines: opts.headlines.map((text, i) => ({
            text,
            ...(i < 3 ? { pinnedField: undefined } : {}),
          })),
          descriptions: opts.descriptions.map(text => ({ text })),
          path1: opts.path1 || "",
          path2: opts.path2 || "",
        },
        finalUrls: [opts.finalUrl],
      },
    },
  }])
  return result.results[0].resourceName
}

export async function listAdGroups(campaignId: string): Promise<Record<string, unknown>[]> {
  return search(`
    SELECT
      ad_group.id, ad_group.name, ad_group.status, ad_group.type,
      ad_group.cpc_bid_micros,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM ad_group
    WHERE campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
  `)
}

export async function listAds(adGroupId: string): Promise<Record<string, unknown>[]> {
  return search(`
    SELECT
      ad_group_ad.ad.id, ad_group_ad.status,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.final_urls,
      metrics.impressions, metrics.clicks, metrics.cost_micros
    FROM ad_group_ad
    WHERE ad_group.id = ${adGroupId}
      AND ad_group_ad.status != 'REMOVED'
  `)
}

export async function updateCampaignStatus(
  campaignResourceName: string,
  status: "ENABLED" | "PAUSED"
): Promise<void> {
  await mutate("campaigns", [{
    update: {
      resourceName: campaignResourceName,
      status,
    },
    updateMask: "status",
  }])
}
