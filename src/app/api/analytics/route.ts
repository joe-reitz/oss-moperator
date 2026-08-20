import { NextRequest, NextResponse } from "next/server"
import {
  queryEvents,
  periodToDateRange,
  aggregateByDay,
  aggregateByUser,
  type Period,
  type StoredEvent,
} from "@agent/lib/analytics"
import { resolveSlackUserNames } from "@/lib/analytics-utils"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

const VALID_PERIODS: Period[] = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "last_30_days",
  "last_90_days",
]

function buildAnalyticsPayload(events: StoredEvent[], startDate: string, endDate: string) {
  const totalEvents = events.length
  const uniqueUsers = [...new Set(events.map((e) => e.userName))]
  const successCount = events.filter((e) => e.success).length
  const successRate = totalEvents > 0 ? Math.round((successCount / totalEvents) * 100) : 0

  const typeCounts: Record<string, number> = {}
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  }
  const topType = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0]

  return {
    period: { start: startDate, end: endDate },
    kpis: {
      totalEvents,
      uniqueUsers: uniqueUsers.length,
      successRate,
      topEventType: topType ? { type: topType[0], count: topType[1] } : null,
    },
    dailyBreakdown: aggregateByDay(events),
    typeCounts: Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    topUsers: aggregateByUser(events).slice(0, 20),
    recentEvents: events
      .slice(-20)
      .reverse()
      .map((e) => ({
        type: e.type,
        userName: e.userName,
        timestamp: e.timestamp,
        success: e.success,
        metadata: e.metadata,
      })),
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = req.nextUrl
  const period = searchParams.get("period") as Period | null
  const customStart = searchParams.get("start")
  const customEnd = searchParams.get("end")

  let start: Date
  let end: Date

  if (customStart && customEnd) {
    start = new Date(customStart)
    end = new Date(customEnd)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 })
    }
  } else {
    const p = period && VALID_PERIODS.includes(period) ? period : "this_quarter"
    const range = periodToDateRange(p)
    start = range.start
    end = range.end
  }

  const rawEvents = await queryEvents(start, end)
  const events = await resolveSlackUserNames(rawEvents)
  const payload = buildAnalyticsPayload(events, start.toISOString(), end.toISOString())

  return NextResponse.json(payload)
}
