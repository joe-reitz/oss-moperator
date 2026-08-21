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

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse CSV text into records keyed by header.
 *
 * Hand-rolled rather than a dependency because the input is a spreadsheet a
 * human exported, and the failure modes are specific: quoted fields containing
 * commas and newlines, doubled quotes as an escape, a UTF-8 BOM from Excel, and
 * CRLF line endings. A naive `split(",")` mangles all four, and silently — which
 * on an import means wrong data in the CRM rather than an error.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Excel prefixes a BOM, which otherwise becomes part of the first header name.
  const input = text.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break, and skip blank lines.
      if (char === "\r" && input[i + 1] === "\n") i++
      row.push(field)
      field = ""
      if (row.some((cell) => cell.trim() !== "")) rows.push(row)
      row = []
    } else {
      field += char
    }
  }
  row.push(field)
  if (row.some((cell) => cell.trim() !== "")) rows.push(row)

  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.trim())
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] ?? "").trim()
    })
    return record
  })
}

/**
 * Find the column holding email addresses.
 *
 * Header names in a hand-made spreadsheet are never what you would guess
 * ("Email Address", "work_email", "E-mail"), so fall back to sampling values.
 */
export function detectEmailColumn(
  records: Record<string, string>[]
): string | undefined {
  if (records.length === 0) return undefined
  const columns = Object.keys(records[0])

  const byName = columns.find((column) => /^e-?mail(\s*address)?$/i.test(column.trim()))
  if (byName) return byName
  const byPartial = columns.find((column) => /e-?mail/i.test(column))
  if (byPartial) return byPartial

  // Nothing in the header looks like an email column; find one by content.
  const sample = records.slice(0, 25)
  return columns.find((column) => {
    const values = sample.map((record) => record[column]).filter(Boolean)
    if (values.length === 0) return false
    return values.filter((value) => EMAIL_PATTERN.test(value)).length / values.length > 0.7
  })
}

/**
 * Deliberately permissive: this is for catching typos and empty cells, not for
 * enforcing RFC 5322. Rejecting a valid-but-unusual address is worse than
 * letting the CRM reject it.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/

/** Lowercase and trim. Most "duplicates" in a real list are casing and spaces. */
export function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

/** Role addresses are not people, and mailing them converts badly. */
export function isRoleAddress(email: string): boolean {
  const local = normalizeEmail(email).split("@")[0] ?? ""
  return [
    "info", "sales", "support", "admin", "contact", "hello", "help", "team",
    "marketing", "billing", "accounts", "office", "enquiries", "inquiries",
    "noreply", "no-reply", "webmaster", "postmaster", "careers", "jobs", "press",
  ].includes(local)
}

/** Free-mail domains in a B2B list usually mean a personal signup. */
export function isFreeMailDomain(email: string): boolean {
  const domain = normalizeEmail(email).split("@")[1] ?? ""
  return [
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
    "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
    "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com",
    "qq.com", "163.com", "126.com",
  ].includes(domain)
}
