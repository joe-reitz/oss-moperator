/**
 * Read-only SOQL validator.
 *
 * Used by the /console playground to ensure user-supplied queries can't write
 * data. SOQL itself is read-only by spec, but we belt-and-suspenders this
 * with a server-side regex check before sending to Salesforce.
 *
 * Rules:
 *   1. Must start with SELECT (after stripping leading whitespace + comments)
 *   2. No DML / mutation keywords anywhere as standalone words
 *   3. No semicolons (prevents query stacking)
 *   4. Length cap (very long queries are usually broken or malicious)
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "UPSERT",
  "MERGE",
  "TRUNCATE",
  "DROP",
  "CREATE",
  "ALTER",
  "EXEC",
  "EXECUTE",
  "FOR UPDATE",
]

const MAX_SOQL_LENGTH = 8000

export interface ValidationResult {
  ok: boolean
  reason?: string
}

export function validateReadOnlySoql(raw: string): ValidationResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "Empty SOQL" }
  }
  if (raw.length > MAX_SOQL_LENGTH) {
    return { ok: false, reason: `SOQL exceeds ${MAX_SOQL_LENGTH}-char limit` }
  }

  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*$/gm, " ")
    .trim()

  if (!stripped) {
    return { ok: false, reason: "Empty SOQL after stripping comments" }
  }

  if (stripped.includes(";")) {
    return { ok: false, reason: "Semicolons not allowed (no statement stacking)" }
  }

  if (!/^select\s/i.test(stripped)) {
    return { ok: false, reason: "Only SELECT queries are allowed" }
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`(^|\\W)${kw.replace(/\s+/g, "\\s+")}(\\W|$)`, "i")
    if (pattern.test(stripped)) {
      return { ok: false, reason: `Forbidden keyword: ${kw}` }
    }
  }

  return { ok: true }
}
