/**
 * Importing a list into the CRM.
 *
 * This is the flow behind "here's a list from the conference — dedupe it against
 * Salesforce and import the new ones", and it is the single most common way bad
 * data gets into a system of record.
 *
 * Three tools, in the order they should be used:
 *
 *   1. `inspect_list` — read the file, find the email column, and report what is
 *      wrong with it before anyone touches the CRM.
 *   2. `dedupe_list_against_salesforce` — chunked lookups against Contact and
 *      Lead, splitting the file into new / already-known / suppressed.
 *   3. `create_salesforce_records` — one bulk insert of the rows that survived.
 *
 * They exist as tools rather than as skill instructions because the parts that
 * go wrong are mechanical, not judgemental: SOQL has a query-length limit so a
 * thousand emails cannot go in one `IN` clause, Salesforce's collections API
 * caps at 200 records per call, and "duplicate" means normalized-and-compared,
 * not string-equal. An agent asked to do that in a prompt will get it subtly
 * wrong on a big file, and the failure is silent.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval } from "../lib/approval"
import { config } from "../lib/config"
import {
  detectEmailColumn,
  EMAIL_PATTERN,
  isFreeMailDomain,
  isRoleAddress,
  normalizeEmail,
  parseCsv,
  recordsToCsv,
} from "../lib/csv"
import { isConfigured } from "../lib/integrations"
import * as sf from "../lib/salesforce/client"
import {
  isSfdcAuthError,
  requireSfdcReauth,
  resolveSfdcRead,
  resolveSfdcWrite,
} from "../lib/salesforce/auth"

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

/** Read and parse a CSV out of the workspace. */
async function readList(
  ctx: Parameters<Parameters<typeof defineTool>[0]["execute"]>[1],
  path: string
): Promise<{ records: Record<string, string>[]; error?: string }> {
  const sandbox = await ctx.getSandbox()
  let text: string
  try {
    text = (await sandbox.readTextFile({ path })) ?? ""
  } catch {
    return {
      records: [],
      error: `Could not read ${path}. Files people attach in Slack land in /workspace/attachments — use glob to find the exact name.`,
    }
  }

  const records = parseCsv(text)
  if (records.length === 0) {
    return {
      records: [],
      error: `${path} parsed to zero rows. It may be empty, or not actually a CSV — check the first few lines with bash.`,
    }
  }
  return { records }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("salesforce")) return null

      return {
        inspect_list: defineTool({
          description: `Read a CSV of people and report what is wrong with it, before anything touches the CRM.

Always the first step on an imported list. Reports the row count, the columns, which column holds emails, and the counts that decide what to do next: malformed emails, duplicates within the file, role addresses (info@, sales@), and free-mail domains.

Report these numbers to the user before proposing an import. Do not fix anything silently — a list with 40 bad rows is a conversation, not a cleanup.`,
          inputSchema: z.object({
            path: z
              .string()
              .describe("Path to the CSV in the workspace, e.g. /workspace/attachments/leads.csv"),
            email_column: z
              .string()
              .optional()
              .describe("Column holding emails. Omit to detect it."),
          }),
          async execute({ path, email_column }, ctx) {
            const { records, error } = await readList(ctx, path)
            if (error) return { success: false as const, error }

            const columns = Object.keys(records[0])
            const emailColumn = email_column ?? detectEmailColumn(records)
            if (!emailColumn) {
              return {
                success: false as const,
                error: `Could not find an email column. Columns present: ${columns.join(", ")}. Pass email_column explicitly.`,
              }
            }

            const seen = new Map<string, number>()
            let malformed = 0
            let blank = 0
            let roleAddresses = 0
            let freeMail = 0

            for (const record of records) {
              const email = normalizeEmail(record[emailColumn])
              if (!email) {
                blank++
                continue
              }
              if (!EMAIL_PATTERN.test(email)) {
                malformed++
                continue
              }
              seen.set(email, (seen.get(email) ?? 0) + 1)
              if (isRoleAddress(email)) roleAddresses++
              if (isFreeMailDomain(email)) freeMail++
            }

            const duplicateRows = Array.from(seen.values()).reduce(
              (total, count) => total + (count - 1),
              0
            )

            return {
              success: true as const,
              path,
              rows: records.length,
              columns,
              email_column: emailColumn,
              unique_emails: seen.size,
              blank_emails: blank,
              malformed_emails: malformed,
              duplicate_rows: duplicateRows,
              role_addresses: roleAddresses,
              free_mail_addresses: freeMail,
              sample: records.slice(0, 3),
            }
          },
        }),

        dedupe_list_against_salesforce: defineTool({
          description: `Check a list against Salesforce and split it into new, already-known, and suppressed.

This is the check people skip and the one that creates the mess. It queries in chunks, so a list of any size works — do not try to do this with query_salesforce and an IN clause, which will exceed SOQL's length limit and silently return the wrong answer.

Writes three CSVs to the workspace and returns their paths plus the counts:
- **new** — not in Salesforce as a Contact or a Lead. The import candidates.
- **existing** — already known. Reports which object and record id, so you can say whether the file has newer information.
- **suppressed** — already opted out or bounced. These must never go onto a sending list, whatever the file says.

Report the numbers before importing anything. The new-rows file is what you pass to create_salesforce_records.`,
          inputSchema: z.object({
            path: z.string().describe("Path to the CSV in the workspace"),
            email_column: z
              .string()
              .optional()
              .describe("Column holding emails. Omit to detect it."),
            objects: z
              .array(z.string())
              .optional()
              .describe(
                `Objects to check against, in priority order. Defaults to this org's configured list: ${config.salesforce.dedupeObjects.join(", ")}.`
              ),
            suppression_fields: z
              .array(z.string())
              .optional()
              .describe(
                'Boolean fields that mean "do not contact". Defaults to HasOptedOutOfEmail and IsEmailBounced where the object has them.'
              ),
          }),
          async execute({ path, email_column, objects, suppression_fields }, ctx) {
            const { records, error } = await readList(ctx, path)
            if (error) return { success: false as const, error }

            const emailColumn = email_column ?? detectEmailColumn(records)
            if (!emailColumn) {
              return {
                success: false as const,
                error: `Could not find an email column. Columns: ${Object.keys(records[0]).join(", ")}.`,
              }
            }

            try {
              const identity = await resolveSfdcRead(ctx)
              if (identity.kind === "refused") {
                return { success: false as const, error: identity.reason }
              }
              const credentials = identity.kind === "user" ? identity.credentials : null

              const targets = objects ?? [...config.salesforce.dedupeObjects]
              const emails = records
                .map((record) => normalizeEmail(record[emailColumn]))
                .filter((email) => email && EMAIL_PATTERN.test(email))

              // Only ask for suppression fields the object actually has —
              // referencing a missing field fails the whole query.
              const known = new Map<
                string,
                { object: string; id: string; suppressed: boolean }
              >()

              for (const objectName of targets) {
                let available: Set<string>
                try {
                  const described = await sf.describeObject(objectName, { credentials })
                  available = new Set(
                    (described.fields as Array<{ name: string }>).map((f) => f.name)
                  )
                } catch (describeError) {
                  return fail(
                    describeError,
                    `Could not inspect ${objectName}. Check the object name.`
                  )
                }

                const wanted = (
                  suppression_fields ?? ["HasOptedOutOfEmail", "IsEmailBounced"]
                ).filter((field) => available.has(field))

                const matches = await sf.findByFieldValues(objectName, "Email", emails, {
                  credentials,
                  extraFields: wanted,
                })

                for (const [email, found] of matches) {
                  // First object in the configured priority order wins, so an
                  // org that treats Leads as authoritative can say so rather
                  // than having Contact hardcoded above it.
                  if (known.has(email)) continue
                  const record = found[0]
                  known.set(email, {
                    object: objectName,
                    id: String(record.Id),
                    suppressed: wanted.some((field) => record[field] === true),
                  })
                }
              }

              // Split, deduping within the file as we go — first row wins.
              const seen = new Set<string>()
              const fresh: Record<string, unknown>[] = []
              const existing: Record<string, unknown>[] = []
              const suppressed: Record<string, unknown>[] = []

              for (const record of records) {
                const email = normalizeEmail(record[emailColumn])
                if (!email || !EMAIL_PATTERN.test(email)) continue
                if (seen.has(email)) continue
                seen.add(email)

                const match = known.get(email)
                if (!match) {
                  fresh.push(record)
                } else if (match.suppressed) {
                  suppressed.push({
                    ...record,
                    _salesforce_object: match.object,
                    _salesforce_id: match.id,
                  })
                } else {
                  existing.push({
                    ...record,
                    _salesforce_object: match.object,
                    _salesforce_id: match.id,
                  })
                }
              }

              const sandbox = await ctx.getSandbox()
              const stem = path.replace(/\.csv$/i, "").split("/").pop() || "list"
              const write = async (name: string, rows: Record<string, unknown>[]) => {
                if (rows.length === 0) return null
                const out = `/workspace/${stem}-${name}.csv`
                await sandbox.writeTextFile({ path: out, content: recordsToCsv(rows) })
                return out
              }

              return {
                success: true as const,
                checked_against: targets,
                total_rows: records.length,
                unique_emails: seen.size,
                new_count: fresh.length,
                existing_count: existing.length,
                suppressed_count: suppressed.length,
                new_path: await write("new", fresh),
                existing_path: await write("existing", existing),
                suppressed_path: await write("suppressed", suppressed),
                note:
                  suppressed.length > 0
                    ? `${suppressed.length} of these people have opted out or bounced. Do not add them to a sending list, whatever the file says.`
                    : undefined,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Dedupe failed")
            }
          },
        }),

        create_salesforce_records: defineTool({
          description: `Insert many records into Salesforce in one operation. This is how you import a list.

**This org imports strangers as ${config.salesforce.importObject}s.** Use that unless the user explicitly asks for something else — the two models are not interchangeable, and picking the wrong one creates records nobody's reports will find.${
            config.salesforce.importObject === "Contact"
              ? `\n\nBecause this org uses Contacts rather than Leads, a Contact wants an AccountId. One created without it is a "private" Contact that most B2B reporting cannot see. Before importing, ask how the Account should be resolved — match existing Accounts by email domain or company name, create missing ones, or accept private Contacts deliberately. Do not silently import without an Account.`
              : `\n\nLeads need no Account, which is why they are the default. Note that Lead requires both LastName and Company — a blank Company fails the row, so set a fallback through \`defaults\` when the file lacks one.`
          }

Pass either \`records\` inline or a \`csv_path\` in the workspace — the path is the normal route after dedupe_list_against_salesforce, since it avoids putting thousands of rows through the conversation.

\`field_map\` renames CSV columns to Salesforce API names ({"Work Email": "Email"}). Columns not in the map are passed through as-is, and columns beginning with an underscore are dropped, so the annotations dedupe adds do not leak into the CRM.

Before calling: state the object, the row count, and where the rows came from. Confirm the required fields with describe_salesforce_object — a missing Company on Lead fails every row.

Partial success is normal and reported: good rows land, bad rows come back with reasons. Cap ${config.limits.bulkMax.toLocaleString()} per call.`,
          inputSchema: z.object({
            object_name: z
              .string()
              .describe(
                `The object API name. This org imports strangers as ${config.salesforce.importObject}.`
              ),
            csv_path: z
              .string()
              .optional()
              .describe("CSV in the workspace whose rows become records"),
            records: z
              .array(z.record(z.string(), z.unknown()))
              .optional()
              .describe("Records to insert, when passing them inline"),
            field_map: z
              .record(z.string(), z.string())
              .optional()
              .describe('CSV column to Salesforce field, e.g. {"Work Email": "Email"}'),
            defaults: z
              .record(z.string(), z.unknown())
              .optional()
              .describe(
                'Values applied to every row, e.g. {"LeadSource": "Conference"}'
              ),
          }),
          approval: bulkApproval((input) => {
            const inline = input?.records
            if (Array.isArray(inline)) return inline.length
            // A path's row count is unknown until the file is read, so assume it
            // is over the review threshold rather than under it.
            return input?.csv_path ? config.limits.bulkApprovalThreshold + 1 : 0
          }),
          async execute(
            { object_name, csv_path, records, field_map, defaults },
            ctx
          ) {
            let rows: Record<string, unknown>[] = records ?? []

            if (csv_path) {
              const loaded = await readList(ctx, csv_path)
              if (loaded.error) return { success: false as const, error: loaded.error }
              rows = loaded.records
            }

            if (rows.length === 0) {
              return {
                success: false as const,
                error: "Nothing to insert — pass records or a csv_path with rows.",
              }
            }
            if (rows.length > config.limits.bulkMax) {
              return {
                success: false as const,
                error: `${rows.length.toLocaleString()} rows is over the ${config.limits.bulkMax.toLocaleString()} limit for one call. Split the file, and say so before you start.`,
              }
            }

            const mapped = rows.map((row) => {
              const out: Record<string, unknown> = { ...(defaults ?? {}) }
              for (const [column, value] of Object.entries(row)) {
                // Drop the annotations dedupe added; they are not CRM fields.
                if (column.startsWith("_")) continue
                if (value === "" || value === undefined) continue
                out[field_map?.[column] ?? column] = value
              }
              return out
            })

            try {
              const identity = await resolveSfdcWrite(ctx)
              if (identity.kind === "refused") {
                return { success: false as const, error: identity.reason }
              }
              const credentials = identity.kind === "user" ? identity.credentials : null
              const actor = identity.kind === "user" ? identity.email : "the service account"

              const result = await sf.createRecords(object_name, mapped, { credentials })

              return {
                success: true as const,
                object_name,
                attempted: mapped.length,
                created: result.created.length,
                failed: result.failed.length,
                recorded_as: actor,
                // A handful of reasons is enough to diagnose; the rest repeat.
                failures: result.failed.slice(0, 10),
                created_ids: result.created.slice(0, 20),
                message:
                  `Created ${result.created.length} of ${mapped.length} ${object_name} records` +
                  (result.failed.length > 0 ? `, ${result.failed.length} failed` : "") +
                  `, recorded in Salesforce as ${actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Insert failed")
            }
          },
        }),
      }
    },
  },
})
