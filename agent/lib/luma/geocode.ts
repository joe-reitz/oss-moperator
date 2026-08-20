import { getRedis } from "../redis"

const CACHE_PREFIX = "moperator:geocode:"
const CACHE_TTL = 60 * 60 * 24 * 30

export interface GeocodeResult {
  latitude: number
  longitude: number
  formattedAddress?: string
}

export interface AddressParts {
  address?: string
  city?: string
  region?: string
  country?: string
}

async function nominatimLookup(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const cacheKey = `${CACHE_PREFIX}${trimmed.toLowerCase()}`
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get<string | GeocodeResult>(cacheKey)
      if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached
    } catch {
      // fall through
    }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=1&addressdetails=0`
    const response = await fetch(url, {
      headers: {
        "User-Agent": "mOperator/1.0 (open-source build; https://github.com/joe-reitz/oss-moperator)",
        "Accept-Language": "en",
      },
    })
    if (!response.ok) {
      console.warn(`[Geocode] Nominatim lookup failed for "${trimmed}": HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const r = data[0]
    const result: GeocodeResult = {
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      formattedAddress: r.display_name,
    }
    if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) return null
    if (redis) {
      redis.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL }).catch(() => {})
    }
    return result
  } catch (err) {
    console.warn(`[Geocode] Error for "${trimmed}":`, err)
    return null
  }
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  return nominatimLookup(address)
}

/**
 * Geocode using structured address parts with progressive fallback —
 * Nominatim's OSM data is patchy for residential addresses, so we try
 * progressively broader queries until one hits.
 */
export async function geocodeAddressParts(parts: AddressParts): Promise<GeocodeResult | null> {
  const { address, city, region, country } = parts
  const queries = [
    [address, city, region, country],
    [city, region, country],
    [city, country],
    [region, country],
  ]
  for (const queryParts of queries) {
    const query = queryParts.filter(Boolean).join(", ")
    if (!query || query.length < 3) continue
    const hit = await nominatimLookup(query)
    if (hit) return hit
  }
  return null
}
