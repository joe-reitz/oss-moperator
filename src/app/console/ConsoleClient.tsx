"use client"

import { useEffect, useState } from "react"
import { SoqlEditor } from "./SoqlEditor"

interface RunResult {
  totalCount: number
  previewCount: number
  truncated: boolean
  elapsedMs: number
  columns: string[]
  rows: Record<string, unknown>[]
}

interface SavedQuery {
  name: string
  soql: string
  savedAt: number
}

export default function ConsoleClient() {
  const [prompt, setPrompt] = useState("")
  const [soql, setSoql] = useState("SELECT Id, Name FROM Account LIMIT 10")
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [saveName, setSaveName] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchSaved() {
      try {
        const res = await fetch("/api/console/queries")
        const data = await res.json()
        if (cancelled) return
        if (data.success && Array.isArray(data.queries)) {
          setSavedQueries(data.queries)
        }
      } catch {
        // Saved queries are nice-to-have; ignore failures silently.
      }
    }
    fetchSaved()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    const name = saveName.trim()
    if (!name) {
      setError("Name the query before saving.")
      return
    }
    if (!soql.trim()) {
      setError("Nothing to save — write some SOQL first.")
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      const res = await fetch("/api/console/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, soql }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Save failed")
      setSavedQueries((prev) => {
        const filtered = prev.filter((q) => q.name !== name)
        return [{ name, soql, savedAt: data.savedAt ?? Date.now() }, ...filtered]
      })
      setSaveName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setIsSaving(false)
    }
  }

  function handleLoadSaved(query: SavedQuery) {
    setSoql(query.soql)
    setResult(null)
    setError(null)
  }

  async function handleDeleteSaved(name: string) {
    const previous = savedQueries
    setSavedQueries(previous.filter((q) => q.name !== name))
    try {
      const res = await fetch(`/api/console/queries?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Delete failed")
    } catch (err) {
      setSavedQueries(previous)
      setError(err instanceof Error ? err.message : "Delete failed")
    }
  }

  async function handleGenerate() {
    setError(null)
    setIsGenerating(true)
    try {
      const res = await fetch("/api/console/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Generation failed")
      setSoql(data.soql)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRun() {
    setError(null)
    setResult(null)
    setIsRunning(true)
    try {
      const res = await fetch("/api/console/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Query failed")
      setResult({
        totalCount: data.totalCount,
        previewCount: data.previewCount,
        truncated: data.truncated,
        elapsedMs: data.elapsedMs,
        columns: data.columns,
        rows: data.rows,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed")
    } finally {
      setIsRunning(false)
    }
  }

  async function handleExport() {
    setError(null)
    setIsExporting(true)
    try {
      const res = await fetch("/api/console/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const cd = res.headers.get("Content-Disposition") || ""
      const match = cd.match(/filename="([^"]+)"/)
      a.download = match ? match[1] : `soql-export-${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="border-b border-gray-800 pb-4">
          <h1 className="text-2xl font-semibold text-green-400">SOQL Console</h1>
          <p className="text-gray-500 text-sm mt-1">
            Read-only Salesforce queries — describe what you need, refine the SOQL, run it, download CSV.
          </p>
        </header>

        {error && (
          <div className="border border-red-700 bg-red-950/40 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="border border-gray-800 rounded-lg p-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-gray-500">Describe what you need (AI will draft a SOQL query)</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. All Accounts created in the last 90 days, with Industry and Annual Revenue"
              className="mt-2 w-full bg-gray-950 border border-gray-800 rounded p-3 text-sm text-white placeholder-gray-600 font-mono resize-none focus:outline-none focus:border-green-700"
              rows={3}
            />
          </label>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            {isGenerating ? "Generating..." : "Generate SOQL →"}
          </button>
        </section>

        <section className="border border-gray-800 rounded-lg p-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-gray-500">SOQL query</span>
            <SoqlEditor value={soql} onChange={setSoql} rows={8} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning || !soql.trim()}
              className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              {isRunning ? "Running..." : "Run query"}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || !soql.trim()}
              className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              {isExporting ? "Exporting..." : "Download CSV"}
            </button>
            <button
              onClick={() => {
                setResult(null)
                setError(null)
              }}
              disabled={!result && !error}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-gray-400 text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              Clear results
            </button>
          </div>
          <div className="border-t border-gray-800 pt-3 flex flex-wrap gap-2 items-center">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Name this query to save it..."
              className="flex-1 min-w-[200px] bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-green-700"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave()
              }}
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !saveName.trim() || !soql.trim()}
              className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              {isSaving ? "Saving..." : "Save query"}
            </button>
          </div>
        </section>

        {savedQueries.length > 0 && (
          <section className="border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs uppercase tracking-wider text-gray-500">Saved queries</h2>
              <span className="text-xs text-gray-700">shared across the team</span>
            </div>
            <ul className="divide-y divide-gray-900">
              {savedQueries.map((query) => (
                <li key={query.name} className="py-2 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{query.name}</div>
                    <div className="text-xs text-gray-500 font-mono truncate">{query.soql}</div>
                  </div>
                  <button
                    onClick={() => handleLoadSaved(query)}
                    className="bg-green-700 hover:bg-green-600 text-white text-xs font-medium px-3 py-1 rounded transition-colors"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDeleteSaved(query.name)}
                    className="bg-gray-900 hover:bg-red-900 text-gray-400 hover:text-red-300 text-xs font-medium px-3 py-1 rounded transition-colors"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result && (
          <section className="border border-gray-800 rounded-lg overflow-hidden">
            <div className="border-b border-gray-800 px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-gray-300">
                <span className="text-green-400 font-medium">{result.totalCount.toLocaleString()}</span> rows ·{" "}
                <span className="text-gray-500">showing {result.previewCount.toLocaleString()}</span>
                {result.truncated && (
                  <span className="text-yellow-400"> · truncated for display — use Download CSV for the full set</span>
                )}
              </span>
              <span className="text-xs text-gray-600">{result.elapsedMs} ms</span>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-950 sticky top-0">
                  <tr>
                    {result.columns.map((col) => (
                      <th key={col} className="text-left px-3 py-2 font-medium text-gray-400 border-b border-gray-800 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-900 hover:bg-gray-950/40">
                      {result.columns.map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-300 whitespace-nowrap">
                          {renderCell(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 && (
                <div className="p-8 text-center text-gray-500 text-sm">No rows returned.</div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return "[object]"
    }
  }
  return String(value)
}
