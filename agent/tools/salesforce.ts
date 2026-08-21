/**
 * Salesforce tools.
 *
 * Resolved per session so the model only sees them when Salesforce is actually
 * configured. An install with no CRM gets no CRM tools, which is what stops the
 * agent from promising a query it cannot run.
 *
 * Writes are gated by the policies in `agent/lib/approval.ts`, and separately
 * carry the **requester's own Salesforce identity** — so `CreatedById` and
 * `LastModifiedById` name a person and the org's own audit trail is the audit
 * trail. Reads use the service account, because attribution buys nothing on a
 * read and nobody should sign in to ask a question.
 *
 * A write that cannot be attributed is refused rather than downgraded. See
 * `agent/lib/salesforce/auth.ts` for why that is the whole point.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, deleteApproval, writeApproval } from "../lib/approval"
import { config } from "../lib/config"
import { isConfigured, missingEnv } from "../lib/integrations"
import * as sf from "../lib/salesforce/client"
import {
  hasSfdcGrant,
  isSfdcAuthError,
  requireSfdcReauth,
  resolveSfdcRead,
  resolveSfdcWrite,
  type SfdcIdentity,
} from "../lib/salesforce/auth"
import { validateReadOnlySoql } from "../lib/soql"
import { writeCsvToWorkspace } from "../lib/workspace"

/** Cap on records returned straight to the model, to protect the context window. */
const INLINE_RECORD_LIMIT = 50

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

/**
 * Turn a resolved identity into the credentials the client wants, or return the
 * refusal. `null` credentials mean the service account, which is correct for
 * reads and an explicit opt-in for writes — never a silent downgrade.
 */
function credentialsOf(identity: SfdcIdentity):
  | { ok: true; credentials: SfdcCredentialsArg; actor: string }
  | { ok: false; error: { success: false; error: string } } {
  if (identity.kind === "refused") {
    return { ok: false, error: { success: false as const, error: identity.reason } }
  }
  if (identity.kind === "service") {
    return { ok: true, credentials: null, actor: "the service account" }
  }
  return { ok: true, credentials: identity.credentials, actor: identity.email }
}

type SfdcCredentialsArg = Parameters<typeof sf.query>[1] extends
  | { credentials?: infer C }
  | undefined
  ? C
  : never

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("salesforce")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        query_salesforce: defineTool({
          description: `Run a SOQL query against Salesforce. Read-only: SELECT only, no DML.

Use this for Contacts, Leads, Accounts, Campaigns, CampaignMembers, Opportunities, and custom objects. Call describe_salesforce_object first when you are unsure of a field's API name — a guessed field name is the most common cause of a failed query.

Returns up to ${INLINE_RECORD_LIMIT} records inline. Larger result sets are truncated, and the full count is reported: use export_salesforce_query to get every row as a file, or analyze the whole set in the sandbox.

Examples:
- SELECT Id, Name, Status FROM Campaign WHERE IsActive = true
- SELECT Id, FirstName, LastName, Email FROM Contact WHERE Account.Name = 'Acme'
- SELECT COUNT() FROM CampaignMember WHERE CampaignId = '701xx000000ABCD'`,
          inputSchema: z.object({
            soql: z.string().describe("The SOQL query to run"),
          }),
          async execute({ soql }, ctx) {
            const check = validateReadOnlySoql(soql)
            if (!check.ok) {
              return {
                success: false as const,
                error: `Not a read-only query: ${check.reason}`,
              }
            }

            try {
              const identity = await resolveSfdcRead(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const records = await sf.queryAllRecords(soql, { credentials })
              const truncated = records.length > INLINE_RECORD_LIMIT

              return {
                success: true as const,
                count: records.length,
                truncated,
                records: truncated ? records.slice(0, INLINE_RECORD_LIMIT) : records,
                note: truncated
                  ? `Showing the first ${INLINE_RECORD_LIMIT} of ${records.length} records. Use export_salesforce_query for the full set.`
                  : undefined,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Query failed")
            }
          },
        }),

        describe_salesforce_object: defineTool({
          description:
            "Get the fields of a Salesforce object — API names, labels, types, picklist values, and whether each is required. Use this before writing a query or a write against an object whose schema you have not seen this session.",
          inputSchema: z.object({
            object_name: z
              .string()
              .describe("The object API name, e.g. Contact, Campaign, Custom_Object__c"),
            name_filter: z
              .string()
              .optional()
              .describe(
                "Only return fields whose API name or label contains this text. Use it to find a field without pulling hundreds."
              ),
          }),
          async execute({ object_name, name_filter }, ctx) {
            try {
              const identity = await resolveSfdcRead(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const described = await sf.describeObject(object_name, { credentials })

              type SfField = {
                name: string
                label: string
                type: string
                nillable: boolean
                updateable: boolean
                picklistValues?: Array<{ value: string; active: boolean }>
              }

              const needle = name_filter?.toLowerCase()
              const all = (described.fields as SfField[]).map((field) => ({
                name: field.name,
                label: field.label,
                type: field.type,
                required: !field.nillable,
                writable: field.updateable,
                values: field.picklistValues
                  ?.filter((option) => option.active)
                  .map((option) => option.value)
                  .slice(0, 25),
              }))

              const matched = needle
                ? all.filter(
                    (field) =>
                      field.name.toLowerCase().includes(needle) ||
                      field.label.toLowerCase().includes(needle)
                  )
                : all

              return {
                success: true as const,
                object_name: described.name,
                label: described.label,
                total_fields: all.length,
                fields: matched.slice(0, 120),
                truncated: matched.length > 120,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Describe failed")
            }
          },
        }),

        list_salesforce_objects: defineTool({
          description:
            "List the queryable Salesforce objects in this org, so you can find the right API name. Filter by name when looking for a specific custom object.",
          inputSchema: z.object({
            name_filter: z
              .string()
              .optional()
              .describe("Only return objects whose API name or label contains this text"),
            custom_only: z
              .boolean()
              .optional()
              .describe("Only return custom objects (those ending in __c)"),
          }),
          async execute({ name_filter, custom_only }, ctx) {
            try {
              const identity = await resolveSfdcRead(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const global = await sf.describeGlobal({ credentials })

              type SObject = {
                name: string
                label: string
                custom: boolean
                queryable: boolean
              }

              const needle = name_filter?.toLowerCase()
              const objects = (global.sobjects as SObject[])
                .filter((object) => object.queryable)
                .filter((object) => (custom_only ? object.custom : true))
                .filter(
                  (object) =>
                    !needle ||
                    object.name.toLowerCase().includes(needle) ||
                    object.label.toLowerCase().includes(needle)
                )
                .map((object) => ({
                  name: object.name,
                  label: object.label,
                  custom: object.custom,
                }))

              return {
                success: true as const,
                count: objects.length,
                objects: objects.slice(0, 200),
                truncated: objects.length > 200,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Failed to list objects")
            }
          },
        }),

        export_salesforce_query: defineTool({
          description: `Run a SOQL query and write every row to a CSV file in the workspace. Prefer this over query_salesforce whenever the answer is a list someone wants to keep, or whenever the result set is too big to read.

The file lands in /workspace, so you can analyze it with bash (pandas, awk, sort) and attach it to your reply. Relationship fields flatten to dotted columns like Account.Name. Paginates the full result set, capped at ${config.limits.csvExportRows.toLocaleString()} rows.`,
          inputSchema: z.object({
            soql: z.string().describe("The SOQL query to run"),
            label: z
              .string()
              .describe(
                "Short description of the data, used for the filename, e.g. 'acme contacts'"
              ),
          }),
          async execute({ soql, label }, ctx) {
            const check = validateReadOnlySoql(soql)
            if (!check.ok) {
              return {
                success: false as const,
                error: `Not a read-only query: ${check.reason}`,
              }
            }

            try {
              const identity = await resolveSfdcRead(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const records = await sf.queryAllRecords(soql, { credentials })
              const written = await writeCsvToWorkspace(ctx, records, label)

              if (!written) {
                return {
                  success: true as const,
                  count: 0,
                  path: null,
                  note: "The query returned no rows, so no file was written.",
                }
              }

              return { success: true as const, ...written }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Export failed")
            }
          },
        }),

        salesforce_connection_status: defineTool({
          description: `Report how this person's Salesforce writes will be attributed, and whether they have connected their own account.

Use it when someone asks "am I connected to Salesforce?", when a write was refused for an identity reason, or before walking someone through their first write.`,
          inputSchema: z.object({}),
          async execute(_input, ctx) {
            const attributes = (ctx.session.auth.initiator?.attributes ??
              ctx.session.auth.current?.attributes ??
              {}) as { email?: string }
            const email = attributes.email
            const mode = config.salesforce.identity

            if (mode === "service") {
              return {
                success: true as const,
                mode,
                connected: false,
                summary:
                  "This install writes to Salesforce as a shared service account (SFDC_IDENTITY=service), so every change is recorded as the integration user rather than as the person who asked for it.",
              }
            }

            const connected = await hasSfdcGrant(email)
            return {
              success: true as const,
              mode,
              email,
              connected,
              summary: connected
                ? `Connected. Salesforce will record ${email} as the author of changes you ask for, so your org's own audit trail and field history attribute them to you.`
                : email
                  ? `Not connected yet. The first time you ask for a Salesforce change you will get a one-time sign-in link; after that your changes are recorded under ${email}.`
                  : "Could not determine your email, so changes cannot be attributed to you. In Slack this usually means the bot is missing the users:read.email scope.",
            }
          },
        }),

        // ── Write ───────────────────────────────────────────────────────────

        create_salesforce_record: defineTool({
          description:
            "Create one record in Salesforce. Confirm the object and field API names with describe_salesforce_object first — a wrong field name fails the whole call. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            object_name: z.string().describe("The object API name, e.g. Campaign"),
            data: z
              .record(z.string(), z.unknown())
              .describe("Field API names mapped to values"),
          }),
          approval: writeApproval(),
          async execute({ object_name, data }, ctx) {
            try {
              const identity = await resolveSfdcWrite(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const id = await sf.createRecord(object_name, data, { credentials })
              return {
                success: true as const,
                id,
                recorded_as: resolved.actor,
                message: `Created ${object_name} ${id}, recorded in Salesforce as ${resolved.actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Create failed")
            }
          },
        }),

        update_salesforce_record: defineTool({
          description:
            "Update one record in Salesforce. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            object_name: z.string().describe("The object API name"),
            record_id: z.string().describe("The 15- or 18-character record ID"),
            data: z
              .record(z.string(), z.unknown())
              .describe("Field API names mapped to new values"),
          }),
          approval: writeApproval(),
          async execute({ object_name, record_id, data }, ctx) {
            try {
              const identity = await resolveSfdcWrite(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              await sf.updateRecord(object_name, record_id, data, { credentials })
              return {
                success: true as const,
                recorded_as: resolved.actor,
                message: `Updated ${object_name} ${record_id}, recorded in Salesforce as ${resolved.actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Update failed")
            }
          },
        }),

        delete_salesforce_record: defineTool({
          description:
            "Delete one record from Salesforce. This is not reversible from here — the record goes to the org's recycle bin. Always requires approval, and never runs from a scheduled task.",
          inputSchema: z.object({
            object_name: z.string().describe("The object API name"),
            record_id: z.string().describe("The record ID to delete"),
          }),
          approval: deleteApproval(),
          async execute({ object_name, record_id }, ctx) {
            try {
              const identity = await resolveSfdcWrite(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              await sf.deleteRecord(object_name, record_id, { credentials })
              return {
                success: true as const,
                recorded_as: resolved.actor,
                message: `Deleted ${object_name} ${record_id}, recorded in Salesforce as ${resolved.actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Delete failed")
            }
          },
        }),

        bulk_update_salesforce_records: defineTool({
          description:
            "Update many Salesforce records in one call. Each entry needs an Id plus the fields to change. Before calling this, tell the user exactly how many records you are about to touch and what will change — then let the approval prompt confirm it. Large batches require approval from everyone, including approvers.",
          inputSchema: z.object({
            object_name: z.string().describe("The object API name"),
            records: z
              .array(z.object({ Id: z.string() }).passthrough())
              .min(1)
              .describe("Records to update, each with an Id and the fields to set"),
          }),
          approval: bulkApproval((input) => {
            const records = input?.records
            return Array.isArray(records) ? records.length : 0
          }),
          async execute({ object_name, records }, ctx) {
            try {
              const identity = await resolveSfdcWrite(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials
              const result = await sf.bulkUpdateRecords(
                object_name,
                records as Array<{ Id: string; [key: string]: unknown }>,
                { credentials }
              )
              return {
                success: true as const,
                updated: result.success,
                failed: result.failed,
                errors: result.errors.slice(0, 10),
                recorded_as: resolved.actor,
                message: `Updated ${result.success} of ${records.length} ${object_name} records${
                  result.failed > 0 ? `, ${result.failed} failed` : ""
                }, recorded in Salesforce as ${resolved.actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Bulk update failed")
            }
          },
        }),

        add_campaign_members: defineTool({
          description: `Add people to a Salesforce campaign as CampaignMembers.

Pass Contact ids, Lead ids, or a mix — each is routed by its key prefix (003 is a Contact, 00Q is a Lead). A deduped import naturally produces a mix: people who already existed are Contacts, the ones you just created are Leads.

**status** must be one of that campaign's configured member statuses, not a value you invent. They are per-campaign, and a wrong one fails every row. Check first:

  SELECT Label, IsDefault FROM CampaignMemberStatus WHERE CampaignId = '701...'

Omit status to use the campaign's default. State the count before calling; large batches always require approval.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The Campaign ID, starts with 701"),
            ids: z
              .array(z.string())
              .min(1)
              .describe("Contact ids (003…), Lead ids (00Q…), or a mix"),
            status: z
              .string()
              .optional()
              .describe(
                "A member status configured on this campaign, e.g. Sent or Responded. Omit for its default."
              ),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ campaign_id, ids, status }, ctx) {
            try {
              const identity = await resolveSfdcWrite(ctx)
              const resolved = credentialsOf(identity)
              if (!resolved.ok) return resolved.error
              const credentials = resolved.credentials

              const result = await sf.addToCampaign(campaign_id, ids, status, {
                credentials,
              })

              return {
                success: true as const,
                added: result.success,
                failed: result.failed,
                contacts: result.contacts,
                leads: result.leads,
                errors: result.errors,
                recorded_as: resolved.actor,
                message:
                  `Added ${result.success} of ${ids.length} members to campaign ${campaign_id}` +
                  ` (${result.contacts} contact(s), ${result.leads} lead(s))` +
                  (result.failed > 0 ? `, ${result.failed} failed` : "") +
                  `, recorded in Salesforce as ${resolved.actor}`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Failed to add campaign members")
            }
          },
        }),
      }
    },
  },
})

/** Surfaced by `eve info` when Salesforce is half-configured. */
export const setupHint = () =>
  isConfigured("salesforce")
    ? null
    : `Salesforce is inactive. Missing: ${missingEnv("salesforce").join(", ")}`
