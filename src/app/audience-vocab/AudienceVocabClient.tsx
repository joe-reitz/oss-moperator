"use client"

import { useEffect, useState } from "react"

type AudienceObject = "Contact" | "Account" | "CampaignMember"

interface VocabularyEntry {
  term: string
  aliases?: string[]
  object: AudienceObject
  field: string
  description: string
  commonValues?: string[]
  avoid?: { field: string; reason: string }[]
  notes?: string
}

interface ListedEntry extends VocabularyEntry {
  source: "static" | "custom" | "override"
  overridden: boolean
  createdAt?: number
  updatedAt?: number
  updatedBy?: string
}

interface ListResponse {
  success: boolean
  static: ListedEntry[]
  custom: ListedEntry[]
  overrides: ListedEntry[]
}

const EMPTY_ENTRY: VocabularyEntry = {
  term: "",
  aliases: [],
  object: "Contact",
  field: "",
  description: "",
  commonValues: [],
  avoid: [],
  notes: "",
}

/** Convert a listed entry (with metadata) back to a plain VocabularyEntry. */
function entryFromListed(e: ListedEntry): VocabularyEntry {
  return {
    term: e.term,
    aliases: e.aliases,
    object: e.object,
    field: e.field,
    description: e.description,
    commonValues: e.commonValues,
    avoid: e.avoid,
    notes: e.notes,
  }
}

/** Escape a string for inclusion in a double-quoted TS string literal. */
function tsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/** Render one entry as a TS object literal matching the format of AUDIENCE_VOCABULARY in vocabulary.ts. */
function renderEntryAsTS(e: VocabularyEntry): string {
  const lines: string[] = ["  {"]
  lines.push(`    term: "${tsEscape(e.term)}",`)
  if (e.aliases && e.aliases.length > 0) {
    lines.push(`    aliases: [${e.aliases.map((a) => `"${tsEscape(a)}"`).join(", ")}],`)
  }
  lines.push(`    object: "${e.object}",`)
  lines.push(`    field: "${tsEscape(e.field)}",`)
  lines.push(`    description: "${tsEscape(e.description)}",`)
  if (e.commonValues && e.commonValues.length > 0) {
    lines.push(`    commonValues: [${e.commonValues.map((v) => `"${tsEscape(v)}"`).join(", ")}],`)
  }
  if (e.avoid && e.avoid.length > 0) {
    lines.push("    avoid: [")
    for (const a of e.avoid) {
      lines.push(`      { field: "${tsEscape(a.field)}", reason: "${tsEscape(a.reason)}" },`)
    }
    lines.push("    ],")
  }
  if (e.notes) {
    lines.push(`    notes: "${tsEscape(e.notes)}",`)
  }
  lines.push("  }")
  return lines.join("\n")
}

export default function AudienceVocabClient() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<VocabularyEntry | null>(null)
  const [isStaticEdit, setIsStaticEdit] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch("/api/audience-vocab")
      const json = await res.json()
      if (!json.success) throw new Error(json.error || "Failed to load")
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSave() {
    if (!editing) return
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/audience-vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || "Save failed")
      await refresh()
      setEditing(null)
      setIsStaticEdit(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(term: string) {
    if (!confirm(`Remove custom vocabulary entry for "${term}"?`)) return
    setError(null)
    try {
      const res = await fetch(`/api/audience-vocab?term=${encodeURIComponent(term)}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || "Delete failed")
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    }
  }

  function startNew() {
    setEditing({ ...EMPTY_ENTRY, aliases: [], commonValues: [], avoid: [] })
    setIsStaticEdit(false)
  }

  function toggleSelected(term: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(term)) next.delete(term)
      else next.add(term)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function handleCopySelected() {
    if (!data || selected.size === 0) return

    const allCandidates: VocabularyEntry[] = [
      ...data.custom.map((e) => entryFromListed(e)),
      ...data.overrides.map((e) => entryFromListed(e)),
    ]
    const picks = allCandidates.filter((e) => selected.has(e.term))
    if (picks.length === 0) return

    const snippet = picks.map(renderEntryAsTS).join(",\n")
    try {
      await navigator.clipboard.writeText(snippet)
      setCopyStatus(`Copied ${picks.length} entr${picks.length === 1 ? "y" : "ies"} to clipboard. Paste into vocabulary.ts to promote them to static defaults.`)
      setTimeout(() => setCopyStatus(null), 5000)
    } catch {
      setCopyStatus("Couldn't auto-copy — select the snippet manually below.")
    }
  }

  function startEdit(entry: ListedEntry, isStatic: boolean) {
    setEditing({
      term: entry.term,
      aliases: entry.aliases || [],
      object: entry.object,
      field: entry.field,
      description: entry.description,
      commonValues: entry.commonValues || [],
      avoid: entry.avoid || [],
      notes: entry.notes || "",
    })
    setIsStaticEdit(isStatic)
  }

  const filterLower = filter.toLowerCase()
  function matches(e: ListedEntry): boolean {
    if (!filterLower) return true
    return (
      e.term.toLowerCase().includes(filterLower) ||
      e.field.toLowerCase().includes(filterLower) ||
      e.description.toLowerCase().includes(filterLower) ||
      (e.aliases || []).some((a) => a.toLowerCase().includes(filterLower))
    )
  }

  const hasAnyEntries = data && (data.static.length + data.custom.length + data.overrides.length) > 0

  return (
    <div className="min-h-screen bg-black text-white font-mono p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="border-b border-gray-800 pb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-green-400">Audience Vocabulary</h1>
            <p className="text-gray-500 text-sm mt-1">
              Marketer-term → canonical Salesforce field mappings used by the agent and SOQL console. Static defaults ship in <code className="text-gray-400">vocabulary.ts</code>; custom Redis entries override at request time without a redeploy.
            </p>
          </div>
          <button
            onClick={startNew}
            className="bg-green-700 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            + Add custom entry
          </button>
        </header>

        {error && (
          <div className="border border-red-700 bg-red-950/40 rounded p-3 text-sm text-red-300">{error}</div>
        )}

        {selected.size > 0 && (
          <div className="border border-green-800 bg-green-950/40 rounded p-3 flex items-center justify-between gap-3 sticky top-2 z-10">
            <span className="text-sm text-green-300">
              {selected.size} entr{selected.size === 1 ? "y" : "ies"} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={clearSelection}
                className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5"
              >
                Clear
              </button>
              <button
                onClick={handleCopySelected}
                className="text-xs bg-green-700 hover:bg-green-600 text-white font-medium px-3 py-1.5 rounded"
              >
                Copy as TS for vocabulary.ts →
              </button>
            </div>
          </div>
        )}

        {copyStatus && (
          <div className="border border-blue-800 bg-blue-950/40 rounded p-3 text-sm text-blue-200">{copyStatus}</div>
        )}

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by term, alias, field, or description..."
          className="w-full bg-gray-950 border border-gray-800 rounded p-3 text-sm placeholder-gray-600 font-mono focus:outline-none focus:border-green-700"
        />

        {!data && !error && <div className="text-gray-500 text-sm">Loading...</div>}

        {data && !hasAnyEntries && (
          <div className="border border-gray-800 bg-gray-950 rounded-lg p-8 text-center text-gray-400">
            <p className="text-sm mb-2">No vocabulary entries yet.</p>
            <p className="text-xs text-gray-600">
              Click <strong className="text-gray-400">+ Add custom entry</strong> to create your first Redis-backed mapping,
              or edit <code className="text-gray-400">src/lib/audience/vocabulary.ts</code> to add static defaults.
            </p>
          </div>
        )}

        {data && (
          <>
            <Section
              title="Custom entries (Redis-backed)"
              subtitle="Editable. Live in production immediately on save. Check the box to bundle for promotion to static defaults."
              entries={data.custom.filter(matches)}
              onEdit={(e) => startEdit(e, false)}
              onDelete={handleDelete}
              accent="green"
              selectable
              selected={selected}
              onToggleSelect={toggleSelected}
            />
            <Section
              title="Overrides of static defaults"
              subtitle="Custom Redis entries that replace built-in defaults of the same term. Delete to restore default."
              entries={data.overrides.filter(matches)}
              onEdit={(e) => startEdit(e, false)}
              onDelete={handleDelete}
              accent="amber"
              selectable
              selected={selected}
              onToggleSelect={toggleSelected}
            />
            <Section
              title="Built-in defaults (read-only)"
              subtitle="Shipped in vocabulary.ts. Click 'Override' to create a custom Redis entry that wins on conflict; delete the override later to restore."
              entries={data.static.filter(matches)}
              onEdit={(e) => startEdit(e, true)}
              accent="gray"
            />
          </>
        )}

        {editing && (
          <EditorModal
            entry={editing}
            isStaticOverride={isStaticEdit}
            onChange={setEditing}
            onCancel={() => {
              setEditing(null)
              setIsStaticEdit(false)
            }}
            onSave={handleSave}
            isSaving={isSaving}
          />
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  entries,
  onEdit,
  onDelete,
  accent,
  selectable,
  selected,
  onToggleSelect,
}: {
  title: string
  subtitle: string
  entries: ListedEntry[]
  onEdit?: (e: ListedEntry) => void
  onDelete?: (term: string) => void
  accent: "green" | "amber" | "gray"
  selectable?: boolean
  selected?: Set<string>
  onToggleSelect?: (term: string) => void
}) {
  if (entries.length === 0) return null
  const accentClasses = {
    green: "border-green-900/50",
    amber: "border-amber-900/50",
    gray: "border-gray-800",
  }[accent]

  return (
    <section className={`border ${accentClasses} rounded-lg p-4 space-y-3`}>
      <div>
        <h2 className="text-sm font-semibold text-gray-300">
          {title} <span className="text-gray-600 font-normal">({entries.length})</span>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              {selectable && <th className="text-left p-2 font-normal w-8"></th>}
              <th className="text-left p-2 font-normal">Term / Aliases</th>
              <th className="text-left p-2 font-normal">Object.Field</th>
              <th className="text-left p-2 font-normal">Description</th>
              <th className="text-right p-2 font-normal w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.term} className="border-b border-gray-900 hover:bg-gray-950/50">
                {selectable && (
                  <td className="p-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected?.has(entry.term) ?? false}
                      onChange={() => onToggleSelect?.(entry.term)}
                      className="accent-green-600 cursor-pointer"
                    />
                  </td>
                )}
                <td className="p-2 align-top">
                  <div className="text-white">{entry.term}</div>
                  {entry.aliases && entry.aliases.length > 0 && (
                    <div className="text-gray-600 mt-1">{entry.aliases.join(", ")}</div>
                  )}
                  {entry.overridden && (
                    <div className="text-amber-400 text-[10px] mt-1">⚠ Overridden by custom entry</div>
                  )}
                </td>
                <td className="p-2 align-top">
                  <code className="text-orange-300">{entry.object}.{entry.field}</code>
                </td>
                <td className="p-2 align-top text-gray-400">
                  {entry.description}
                  {entry.notes && <div className="text-gray-600 mt-1 italic">{entry.notes}</div>}
                </td>
                <td className="p-2 align-top text-right space-x-2">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(entry)}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      {entry.source === "static" ? "Override" : "Edit"}
                    </button>
                  )}
                  {onDelete && entry.source !== "static" && (
                    <button
                      onClick={() => onDelete(entry.term)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EditorModal({
  entry,
  isStaticOverride,
  onChange,
  onCancel,
  onSave,
  isSaving,
}: {
  entry: VocabularyEntry
  isStaticOverride: boolean
  onChange: (e: VocabularyEntry) => void
  onCancel: () => void
  onSave: () => void
  isSaving: boolean
}) {
  const [aliasesText, setAliasesText] = useState(() => (entry.aliases || []).join(", "))
  const [commonValuesText, setCommonValuesText] = useState(() => (entry.commonValues || []).join(", "))

  function parseList(s: string): string[] {
    return s.split(",").map((x) => x.trim()).filter(Boolean)
  }

  function update<K extends keyof VocabularyEntry>(key: K, value: VocabularyEntry[K]) {
    onChange({ ...entry, [key]: value })
  }

  function commitListsAndSave() {
    onChange({
      ...entry,
      aliases: parseList(aliasesText),
      commonValues: parseList(commonValuesText),
    })
    setTimeout(onSave, 0)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start justify-center p-6 overflow-y-auto z-50">
      <div className="bg-gray-950 border border-gray-700 rounded-lg p-6 max-w-2xl w-full space-y-4 my-12">
        <h2 className="text-lg font-semibold text-green-400">
          {isStaticOverride ? "Override built-in default" : entry.term ? "Edit entry" : "New custom entry"}
        </h2>
        {isStaticOverride && (
          <p className="text-xs text-amber-400">
            This will create a custom Redis entry that overrides the built-in default for this term. Delete the override later to restore the default.
          </p>
        )}

        <Field label="Term" hint="Primary phrase a marketer would say. Used as the unique key.">
          <input
            type="text"
            value={entry.term}
            onChange={(e) => update("term", e.target.value)}
            disabled={isStaticOverride}
            className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono disabled:opacity-50"
          />
        </Field>

        <Field label="Aliases" hint="Comma-separated. Other phrasings that should resolve to the same field.">
          <input
            type="text"
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            placeholder='sub industry, sub-industry, vertical'
            className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Object" hint="Salesforce object this field lives on.">
            <select
              value={entry.object}
              onChange={(e) => update("object", e.target.value as AudienceObject)}
              className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
            >
              <option value="Contact">Contact</option>
              <option value="Account">Account</option>
              <option value="CampaignMember">CampaignMember</option>
            </select>
          </Field>
          <Field label="Field" hint="API name with relationship traversal if needed.">
            <input
              type="text"
              value={entry.field}
              onChange={(e) => update("field", e.target.value)}
              placeholder="Custom_Segment__c"
              className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
            />
          </Field>
        </div>

        <Field label="Description" hint="One-liner the agent uses to explain this mapping.">
          <textarea
            value={entry.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
          />
        </Field>

        <Field label="Common values" hint="Comma-separated picklist values, if known.">
          <input
            type="text"
            value={commonValuesText}
            onChange={(e) => setCommonValuesText(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
          />
        </Field>

        <Field label="Notes" hint="Free-form context — when to use this, edge cases, etc.">
          <textarea
            value={entry.notes || ""}
            onChange={(e) => update("notes", e.target.value)}
            rows={2}
            className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-sm font-mono"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded"
          >
            Cancel
          </button>
          <button
            onClick={commitListsAndSave}
            disabled={isSaving || !entry.term.trim() || !entry.field.trim() || !entry.description.trim()}
            className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium px-4 py-2 rounded"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-gray-500">{label}</span>
      {hint && <span className="block text-xs text-gray-600 mt-0.5">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}
