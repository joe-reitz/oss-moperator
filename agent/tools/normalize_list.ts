/**
 * Normalize the fields that segment badly when they are written five ways.
 *
 * "VP of Marketing", "V.P. Marketing", and "vp marketing" are one title and
 * three segments. "Acme, Inc." and "Acme Inc" are one account. Pure logic, so it
 * runs on any CSV in the workspace with no CRM involved.
 *
 * Conservative by design: anything it cannot classify is left alone and counted,
 * rather than guessed at. A wrong normalization is worse than none, because it
 * is invisible afterwards.
 */

import { defineTool } from "eve/tools"
import { z } from "zod"

import { parseCsv, recordsToCsv } from "../lib/csv"
import {
  companyKey,
  normalizeCountry,
  normalizePersonName,
  normalizeSeniority,
  phoneKey,
} from "../lib/normalize"

export default defineTool({
  description: `Normalize the columns of a CSV that otherwise fragment reporting: countries to ISO codes, job titles to seniority bands, company names to a comparison key, and person names out of ALL CAPS.

Adds new columns rather than overwriting, so the original values survive and you can show someone what changed. Writes a new file and reports how many values in each column it could and could not classify.

Unrecognized values are left alone and counted — that count is the interesting number, because it tells you what your picklists are actually missing. Report it.`,
  inputSchema: z.object({
    path: z.string().describe("Path to the CSV in the workspace"),
    country_column: z.string().optional().describe("Column holding country names"),
    title_column: z.string().optional().describe("Column holding job titles"),
    company_column: z.string().optional().describe("Column holding company names"),
    name_columns: z
      .array(z.string())
      .optional()
      .describe("Columns holding person names, e.g. ['First Name', 'Last Name']"),
    phone_column: z.string().optional().describe("Column holding phone numbers"),
  }),
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox()

    let text: string
    try {
      text = (await sandbox.readTextFile({ path: input.path })) ?? ""
    } catch {
      return {
        success: false as const,
        error: `Could not read ${input.path}. Use glob to find the exact path.`,
      }
    }

    const records = parseCsv(text)
    if (records.length === 0) {
      return { success: false as const, error: `${input.path} parsed to zero rows.` }
    }

    const columns = Object.keys(records[0])
    const missing = [
      input.country_column,
      input.title_column,
      input.company_column,
      input.phone_column,
      ...(input.name_columns ?? []),
    ].filter((column): column is string => !!column && !columns.includes(column))

    if (missing.length > 0) {
      return {
        success: false as const,
        error: `These columns are not in the file: ${missing.join(", ")}. Columns present: ${columns.join(", ")}`,
      }
    }

    const stats = {
      countries_mapped: 0,
      countries_unrecognized: [] as string[],
      seniority: {} as Record<string, number>,
      companies_keyed: 0,
      names_recased: 0,
      phones_keyed: 0,
    }

    const out = records.map((record) => {
      const next: Record<string, unknown> = { ...record }

      if (input.country_column) {
        const raw = record[input.country_column]
        const iso = normalizeCountry(raw)
        next.country_iso = iso ?? ""
        if (iso) stats.countries_mapped++
        else if (raw?.trim()) stats.countries_unrecognized.push(raw.trim())
      }

      if (input.title_column) {
        const band = normalizeSeniority(record[input.title_column])
        next.seniority = band
        stats.seniority[band] = (stats.seniority[band] ?? 0) + 1
      }

      if (input.company_column) {
        const key = companyKey(record[input.company_column])
        next.company_key = key
        if (key) stats.companies_keyed++
      }

      for (const column of input.name_columns ?? []) {
        const recased = normalizePersonName(record[column])
        if (recased !== record[column]) stats.names_recased++
        next[`${column} (normalized)`] = recased
      }

      if (input.phone_column) {
        const key = phoneKey(record[input.phone_column])
        next.phone_key = key
        if (key) stats.phones_keyed++
      }

      return next
    })

    const stem = input.path.replace(/\.csv$/i, "").split("/").pop() || "list"
    const outPath = `/workspace/${stem}-normalized.csv`
    await sandbox.writeTextFile({ path: outPath, content: recordsToCsv(out) })

    // The unrecognized set is the useful output: it is what the picklists miss.
    const unrecognized = Array.from(new Set(stats.countries_unrecognized))

    return {
      success: true as const,
      path: outPath,
      rows: out.length,
      added_columns: Object.keys(out[0]).filter((column) => !columns.includes(column)),
      countries_mapped: stats.countries_mapped,
      countries_unrecognized: unrecognized.slice(0, 25),
      countries_unrecognized_count: unrecognized.length,
      seniority_breakdown: stats.seniority,
      companies_keyed: stats.companies_keyed,
      names_recased: stats.names_recased,
      phones_keyed: stats.phones_keyed,
      note:
        unrecognized.length > 0
          ? `${unrecognized.length} country value(s) could not be mapped and were left as-is. Report them — they are usually what a picklist is missing.`
          : undefined,
    }
  },
})
