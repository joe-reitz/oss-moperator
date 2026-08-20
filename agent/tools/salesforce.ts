/**
 * Salesforce tools.
 *
 * Resolved per session so the model only sees them when Salesforce is actually
 * configured. An install with no CRM gets no CRM tools, which is what stops the
 * agent from promising a query it cannot run.
 *
 * Writes are gated by the policies in `agent/lib/approval.ts`. When
 * SFDC_USER_OAUTH_ENABLED=true, each write resolves the caller's own Salesforce
 * token first, so `CreatedById` shows the person rather than a service account.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, deleteApproval, writeApproval } from "../lib/approval"
import { config } from "../lib/config"
import { isConfigured, missingEnv } from "../lib/integrations"
import * as sf from "../lib/salesforce/client"
import {
  isSfdcAuthError,
  requireSfdcReauth,
  resolveSfdcCredentials,
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
              const credentials = await resolveSfdcCredentials(ctx)
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
              const credentials = await resolveSfdcCredentials(ctx)
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
              const credentials = await resolveSfdcCredentials(ctx)
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
              const credentials = await resolveSfdcCredentials(ctx)
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
              const credentials = await resolveSfdcCredentials(ctx)
              const id = await sf.createRecord(object_name, data, { credentials })
              return {
                success: true as const,
                id,
                message: `Created ${object_name} ${id}`,
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
              const credentials = await resolveSfdcCredentials(ctx)
              await sf.updateRecord(object_name, record_id, data, { credentials })
              return {
                success: true as const,
                message: `Updated ${object_name} ${record_id}`,
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
              const credentials = await resolveSfdcCredentials(ctx)
              await sf.deleteRecord(object_name, record_id, { credentials })
              return {
                success: true as const,
                message: `Deleted ${object_name} ${record_id}`,
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
              const credentials = await resolveSfdcCredentials(ctx)
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
                message: `Updated ${result.success} of ${records.length} ${object_name} records${
                  result.failed > 0 ? `, ${result.failed} failed` : ""
                }`,
              }
            } catch (error) {
              if (isSfdcAuthError(error)) requireSfdcReauth(ctx)
              return fail(error, "Bulk update failed")
            }
          },
        }),

        add_contacts_to_campaign: defineTool({
          description:
            "Add contacts to a Salesforce campaign as CampaignMembers. Requires approval unless the caller is an approver; large batches always require approval.",
          inputSchema: z.object({
            campaign_id: z.string().describe("The Campaign ID, starts with 701"),
            contact_ids: z.array(z.string()).min(1).describe("Contact IDs to add"),
            status: z
              .string()
              .optional()
              .describe("CampaignMember status, e.g. Sent, Responded. Defaults to Sent."),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.contact_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ campaign_id, contact_ids, status }, ctx) {
            try {
              const credentials = await resolveSfdcCredentials(ctx)
              const result = await sf.addToCampaign(campaign_id, contact_ids, status, {
                credentials,
              })
              return {
                success: true as const,
                added: result.success,
                failed: result.failed,
                message: `Added ${result.success} of ${contact_ids.length} contacts to campaign ${campaign_id}`,
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
