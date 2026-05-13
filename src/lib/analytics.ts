/**
 * Analytics Event Log
 *
 * Tracks completed actions in Redis so the agent can report on its own
 * work history. Uses sorted sets (score = timestamp) for time-range
 * queries and hashes for monthly counters.
 *
 * Fire-and-forget — never blocks the main flow.
 */

import { createLogger } from "@/lib/logger"
import { getRedis } from "@/lib/redis"

const log = createLogger("Analytics")

const EVENTS_KEY = "moperator:analytics:events"
const COUNTS_PREFIX = "moperator:analytics:counts"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalyticsEvent {
  type: string
  userId: string
  userName: string
  channelId: string
  threadTs: string
  success: boolean
  metadata: Record<string, unknown>
}

export interface StoredEvent extends AnalyticsEvent {
  timestamp: string
  id: string
}

// ─── Event Tracking ─────────────────────────────────────────────────────────

/**
 * Track an analytics event. Fire-and-forget — errors are logged but
 * never thrown.
 */
export function trackEvent(event: AnalyticsEvent): void {
  const redis = getRedis()
  if (!redis) return

  const now = Date.now()
  const yearMonth = new Date(now).toISOString().slice(0, 7)

  const stored: StoredEvent = {
    ...event,
    timestamp: new Date(now).toISOString(),
    id: `${event.type}:${now}:${Math.random().toString(36).slice(2, 8)}`,
  }

  Promise.all([
    redis.zadd(EVENTS_KEY, { score: now, member: JSON.stringify(stored) }),
    redis.hincrby(`${COUNTS_PREFIX}:${yearMonth}`, event.type, 1),
  ]).catch((err) => {
    log.warn("Failed to track event", { type: event.type, error: String(err) })
  })
}

// ─── Event Querying ─────────────────────────────────────────────────────────

export async function queryEvents(
  startDate: Date,
  endDate?: Date,
  type?: string
): Promise<StoredEvent[]> {
  const redis = getRedis()
  if (!redis) return []

  const start = startDate.getTime()
  const end = endDate ? endDate.getTime() : Date.now()

  const raw: string[] = await redis.zrange(EVENTS_KEY, start, end, { byScore: true })

  const events: StoredEvent[] = raw.map((item) => {
    if (typeof item === "string") return JSON.parse(item)
    return item
  })

  if (type) {
    return events.filter((e) => e.type === type)
  }

  return events
}

export async function getMonthlyCounts(
  months: number
): Promise<Array<{ month: string; counts: Record<string, number> }>> {
  const redis = getRedis()
  if (!redis) return []

  const results: Array<{ month: string; counts: Record<string, number> }> = []
  const now = new Date()

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yearMonth = d.toISOString().slice(0, 7)
    const raw = await redis.hgetall(`${COUNTS_PREFIX}:${yearMonth}`)

    const counts: Record<string, number> = {}
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) {
        counts[key] = typeof value === "number" ? value : parseInt(String(value), 10) || 0
      }
    }

    results.push({ month: yearMonth, counts })
  }

  return results
}

// ─── Period helpers ─────────────────────────────────────────────────────────

export type Period =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "last_30_days"
  | "last_90_days"

export function periodToDateRange(period: Period): { start: Date; end: Date } {
  const now = new Date()

  switch (period) {
    case "this_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: now,
      }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      return { start, end }
    }
    case "this_quarter": {
      const calendarQStart = Math.floor(now.getMonth() / 3) * 3
      return {
        start: new Date(now.getFullYear(), calendarQStart, 1),
        end: now,
      }
    }
    case "last_quarter": {
      const calendarQStart = Math.floor(now.getMonth() / 3) * 3
      const prevQStart = (calendarQStart - 3 + 12) % 12
      const yearAdj = prevQStart > calendarQStart ? -1 : 0
      const start = new Date(now.getFullYear() + yearAdj, prevQStart, 1)
      const end = new Date(now.getFullYear(), calendarQStart, 0, 23, 59, 59, 999)
      return { start, end }
    }
    case "last_30_days":
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: now,
      }
    case "last_90_days":
      return {
        start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        end: now,
      }
  }
}

// ─── Aggregation helpers ────────────────────────────────────────────────────

export function aggregateByDay(
  events: StoredEvent[]
): Array<Record<string, string | number>> {
  const byDay = new Map<string, Record<string, number>>()

  for (const e of events) {
    const date = e.timestamp.slice(0, 10)
    if (!byDay.has(date)) byDay.set(date, {})
    const day = byDay.get(date)!
    day[e.type] = (day[e.type] || 0) + 1
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }))
}

export function aggregateByUser(
  events: StoredEvent[]
): Array<{ userName: string; userId: string; count: number; lastActive: string }> {
  const byUser = new Map<string, { userId: string; count: number; lastActive: string }>()

  for (const e of events) {
    const existing = byUser.get(e.userName)
    if (!existing) {
      byUser.set(e.userName, { userId: e.userId, count: 1, lastActive: e.timestamp })
    } else {
      existing.count++
      if (e.timestamp > existing.lastActive) existing.lastActive = e.timestamp
    }
  }

  return Array.from(byUser.entries())
    .map(([userName, data]) => ({ userName, ...data }))
    .sort((a, b) => b.count - a.count)
}
