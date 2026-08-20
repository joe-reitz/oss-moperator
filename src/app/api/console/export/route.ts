/**
 * POST /api/console/export
 *
 * Run a read-only SOQL query and return the full result set as a CSV file
 * download. The page wires this to a "Download CSV" button.
 */

import { NextRequest } from "next/server"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import { queryAllRecords } from "@agent/lib/salesforce/client"
import { recordsToCsv } from "@agent/lib/csv"
import { validateReadOnlySoql } from "@agent/lib/soql"

export const dynamic = "force-dynamic"
export const maxDuration = 300

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

    const records = await queryAllRecords(soql)

    for (const row of records) {
      if ("attributes" in row) delete (row as Record<string, unknown>).attributes
    }

    const csv = recordsToCsv(records)
    const date = new Date().toISOString().split("T")[0]
    const filename = `soql-export-${date}.csv`

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed"
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
