/**
 * Shared Redis client singleton
 *
 * Supports both Upstash and Vercel KV env var naming.
 * Returns null if Redis is not configured (graceful degradation).
 */

import { Redis } from "@upstash/redis"
import { createLogger } from "@/lib/logger"

const log = createLogger("Redis")

let _instance: Redis | null | undefined

export function getRedis(): Redis | null {
  if (_instance !== undefined) return _instance

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    log.warn("Redis not configured, falling back to no-op")
    _instance = null
    return null
  }

  _instance = new Redis({ url, token })
  log.info("Redis client initialized", { urlPrefix: url.substring(0, 20) })
  return _instance
}
