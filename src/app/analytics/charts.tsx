"use client"

import { useState, useEffect, useCallback } from "react"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

const COLORS = [
  "#4ade80",
  "#60a5fa",
  "#c084fc",
  "#fbbf24",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
  "#f97316",
]

const PERIOD_LABELS: Record<string, string> = {
  this_quarter: "This Quarter",
  last_quarter: "Last Quarter",
  this_month: "This Month",
  last_month: "Last Month",
  last_30_days: "Last 30 Days",
  last_90_days: "Last 90 Days",
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

interface AnalyticsData {
  period: { start: string; end: string }
  kpis: {
    totalEvents: number
    uniqueUsers: number
    successRate: number
    topEventType: { type: string; count: number } | null
  }
  dailyBreakdown: Array<Record<string, string | number>>
  typeCounts: Array<{ type: string; count: number }>
  topUsers: Array<{ userName: string; count: number; lastActive: string }>
  recentEvents: Array<{
    type: string
    userName: string
    timestamp: string
    success: boolean
    metadata: Record<string, unknown>
  }>
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {formatEventType(entry.dataKey)}: {entry.value}
        </p>
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border border-gray-800 rounded-lg p-5 bg-gray-950">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className="text-3xl font-mono font-bold text-white">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function UsageOverTimeChart({ data }: { data: AnalyticsData["dailyBreakdown"] }) {
  const eventTypes = [...new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== "date")))]
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())

  if (!data.length) {
    return <p className="text-gray-600 text-sm text-center py-12">No data for this period</p>
  }

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const visibleTypes = eventTypes.filter((t) => !hiddenTypes.has(t))

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip content={<DarkTooltip />} />
          {visibleTypes.map((type) => {
            const colorIndex = eventTypes.indexOf(type)
            return (
              <Area
                key={type}
                type="monotone"
                dataKey={type}
                stackId="1"
                stroke={COLORS[colorIndex % COLORS.length]}
                fill={COLORS[colorIndex % COLORS.length]}
                fillOpacity={0.3}
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {eventTypes.map((type) => {
          const colorIndex = eventTypes.indexOf(type)
          const active = !hiddenTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all cursor-pointer ${
                active
                  ? "bg-gray-800 text-gray-200"
                  : "bg-gray-900 text-gray-600 line-through"
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: active ? COLORS[colorIndex % COLORS.length] : "#374151",
                }}
              />
              {formatEventType(type)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EventBreakdownChart({ data }: { data: AnalyticsData["typeCounts"] }) {
  if (!data.length) {
    return <p className="text-gray-600 text-sm text-center py-12">No data for this period</p>
  }

  const chartData = data.map((d) => ({
    name: formatEventType(d.type),
    count: d.count,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
        <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis
          dataKey="name"
          type="category"
          stroke="#6b7280"
          tick={{ fontSize: 11 }}
          width={180}
        />
        <Tooltip content={<DarkTooltip />} />
        <Bar dataKey="count" fill="#4ade80" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function AnalyticsDashboard({ initialData, initialPeriod }: { initialData: AnalyticsData; initialPeriod: string }) {
  const [data, setData] = useState<AnalyticsData>(initialData)
  const [period, setPeriod] = useState(initialPeriod)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics?period=${p}`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (period !== initialPeriod) fetchData(period)
  }, [period, initialPeriod, fetchData])

  const periodStart = new Date(data.period.start)
  const periodEnd = new Date(data.period.end)
  const rangeLabel = `${periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — ${periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`

  return (
    <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">mOperator Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">{rangeLabel}</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:border-green-400 focus:outline-none cursor-pointer"
        >
          {Object.entries(PERIOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Total Actions" value={data.kpis.totalEvents.toLocaleString()} />
        <KpiCard label="Active Users" value={data.kpis.uniqueUsers} />
        <KpiCard label="Success Rate" value={`${data.kpis.successRate}%`} />
        <KpiCard
          label="Top Action"
          value={data.kpis.topEventType ? formatEventType(data.kpis.topEventType.type) : "—"}
          sub={data.kpis.topEventType ? `${data.kpis.topEventType.count} times` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
        <section className="border border-gray-800 rounded-lg p-5 bg-gray-950">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Usage Over Time</h2>
          <UsageOverTimeChart data={data.dailyBreakdown} />
        </section>
        <section className="border border-gray-800 rounded-lg p-5 bg-gray-950">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Actions by Type</h2>
          <EventBreakdownChart data={data.typeCounts} />
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="border border-gray-800 rounded-lg p-5 bg-gray-950">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Top Users</h2>
          {data.topUsers.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-8">No data for this period</p>
          ) : (
            <div className="space-y-2">
              {data.topUsers.slice(0, 10).map((user, i) => (
                <div key={user.userName} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-600 text-xs font-mono w-5 text-right">{i + 1}</span>
                    <span className="text-white text-sm">{user.userName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-24 bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-green-400 h-1.5 rounded-full"
                        style={{ width: `${(user.count / data.topUsers[0].count) * 100}%` }}
                      />
                    </div>
                    <span className="text-gray-400 text-xs font-mono w-8 text-right">{user.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border border-gray-800 rounded-lg p-5 bg-gray-950">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent Activity</h2>
          {data.recentEvents.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-8">No data for this period</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.recentEvents.map((event, i) => (
                <div key={i} className="flex items-start justify-between py-1.5 border-b border-gray-800/50 last:border-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${event.success ? "bg-green-400" : "bg-red-400"}`} />
                      <span className="text-white text-sm truncate">{formatEventType(event.type)}</span>
                    </div>
                    <p className="text-gray-500 text-xs ml-3.5">{event.userName}</p>
                  </div>
                  <span className="text-gray-600 text-xs whitespace-nowrap ml-2">
                    {new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
