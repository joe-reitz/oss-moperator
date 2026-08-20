/**
 * Writing result sets into the sandbox workspace.
 *
 * This is the mechanism behind "export this as a CSV" and behind any real
 * analysis. Rather than pushing thousands of rows through the model's context,
 * a tool writes the full result set to `/workspace` and hands back a path. From
 * there the agent can run pandas or awk over it with `bash`, and the Slack
 * channel can attach the file to a reply.
 *
 * It is also what makes a 200k-row answer possible at all: the model reads a
 * summary, not the data.
 */

import type { ToolContext } from "eve/tools"

import { config } from "./config"
import { csvFilename, recordsToCsv } from "./csv"

export interface WrittenCsv {
  /** Absolute sandbox path, e.g. /workspace/acme-contacts-2026-08-20.csv */
  path: string
  filename: string
  /** Rows actually written. */
  rows: number
  /** Rows the query returned, before any cap. */
  total: number
  truncated: boolean
  columns: string[]
  bytes: number
}

/**
 * Write records to a CSV in the workspace, capped at `limits.csvExportRows`.
 * Returns null for an empty result set — writing a header-only file just
 * creates a confusing attachment.
 */
export async function writeCsvToWorkspace(
  ctx: ToolContext,
  records: Record<string, unknown>[],
  label: string
): Promise<WrittenCsv | null> {
  if (records.length === 0) return null

  const cap = config.limits.csvExportRows
  const truncated = records.length > cap
  const rows = truncated ? records.slice(0, cap) : records

  const csv = recordsToCsv(rows)
  const filename = csvFilename(label)
  const path = `/workspace/${filename}`

  const sandbox = await ctx.getSandbox()
  await sandbox.writeTextFile({ path, content: csv })

  const header = csv.slice(0, csv.indexOf("\n") === -1 ? undefined : csv.indexOf("\n"))

  return {
    path,
    filename,
    rows: rows.length,
    total: records.length,
    truncated,
    columns: header ? header.split(",") : [],
    bytes: Buffer.byteLength(csv, "utf8"),
  }
}
