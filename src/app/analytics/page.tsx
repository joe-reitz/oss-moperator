import { redirect } from "next/navigation"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import {
  queryEvents,
  periodToDateRange,
  aggregateByDay,
  aggregateByUser,
} from "@/lib/analytics"
import { resolveSlackUserNames } from "@/lib/analytics-utils"
import { AnalyticsDashboard } from "./charts"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "mOperator Analytics",
  description: "Usage analytics for mOperator",
}

export default async function AnalyticsPage() {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const params = new URLSearchParams({ returnTo: "/analytics" })
      if (err.code === "not_authorized") params.set("error", "unauthorized")
      redirect(`${err.redirectTo}${err.redirectTo.includes("?") ? "&" : "?"}${params.toString()}`)
    }
    throw err
  }

  const period = "this_quarter"
  const { start, end } = periodToDateRange(period)
  let events = await queryEvents(start, end)
  events = await resolveSlackUserNames(events)

  const totalEvents = events.length
  const uniqueUsers = [...new Set(events.map((e) => e.userName))]
  const successCount = events.filter((e) => e.success).length
  const successRate = totalEvents > 0 ? Math.round((successCount / totalEvents) * 100) : 0

  const typeCounts: Record<string, number> = {}
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  }
  const topType = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0]

  const initialData = {
    period: { start: start.toISOString(), end: end.toISOString() },
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

  return (
    <div className="min-h-screen bg-black text-white p-6 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <AnalyticsDashboard initialData={initialData} initialPeriod={period} />
      </div>
    </div>
  )
}
