/**
 * POST /api/console/run
 *
 * Execute a read-only SOQL query for the /console playground.
 * Returns rows + metadata; the page renders them as a table.
 */

import { NextRequest } from "next/server"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import { queryAllRecords } from "@/lib/integrations/salesforce/client"
import { validateReadOnlySoql } from "@/lib/soql-validator"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_PREVIEW_ROWS = 1000

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return Response.json({ success: false, error: err.message }, { status: 401 })
    }
    throw err
  }

  try {
    const body = await req.json().catch(() => ({}))
    const soql = typeof body.soql === "string" ? body.soql : ""

    const validation = validateReadOnlySoql(soql)
    if (!validation.ok) {
      return Response.json({ success: false, error: validation.reason }, { status: 400 })
    }

    const start = Date.now()
    const records = await queryAllRecords(soql)
    const elapsedMs = Date.now() - start

    const preview = records.slice(0, MAX_PREVIEW_ROWS)
    const truncated = records.length > MAX_PREVIEW_ROWS

    const columns: string[] = []
    const seen = new Set<string>()
    for (const row of preview) {
      for (const key of Object.keys(row)) {
        if (key === "attributes") continue
        if (!seen.has(key)) {
          seen.add(key)
          columns.push(key)
        }
      }
    }

    return Response.json({
      success: true,
      totalCount: records.length,
      previewCount: preview.length,
      truncated,
      elapsedMs,
      columns,
      rows: preview,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed"
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
