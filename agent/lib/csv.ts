/**
 * CSV helpers, shared by the export tool, the SOQL console, and the sandbox.
 *
 * `attributes` is stripped because every jsforce record carries a nested
 * `{ type, url }` object that is noise in a spreadsheet, and relationship
 * fields are flattened to dotted paths so `Account.Name` becomes a real column
 * instead of a JSON blob.
 */

/** Strip jsforce metadata and flatten nested relationship objects. */
export function flattenRecord(
  record: Record<string, unknown>,
  prefix = ""
): Record<string, unknown> {
  const flat: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes") continue
    const path = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      // A subquery result (`{ records: [...] }`) has no flat representation.
      if (Array.isArray(nested.records)) {
        flat[path] = JSON.stringify(nested.records)
        continue
      }
      Object.assign(flat, flattenRecord(nested, path))
      continue
    }

    flat[path] = value
  }

  return flat
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = typeof value === "object" ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Render records as CSV. Columns are the union of every record's keys, so a
 * sparse result set still lines up.
 */
export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (!records || records.length === 0) return ""

  const flattened = records.map((record) => flattenRecord(record))
  const columns = Array.from(new Set(flattened.flatMap((row) => Object.keys(row))))

  const lines = [columns.join(",")]
  for (const row of flattened) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(","))
  }

  return lines.join("\n")
}

/** A filesystem-safe, dated filename, e.g. "campaign-members-2026-08-20.csv". */
export function csvFilename(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "export"
  return `${slug}-${new Date().toISOString().slice(0, 10)}.csv`
}
