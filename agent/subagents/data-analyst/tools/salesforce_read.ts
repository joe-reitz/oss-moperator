/**
 * Read-only Salesforce tools for the analyst.
 *
 * Deliberately a separate, smaller definition than the root's
 * `agent/tools/salesforce.ts`: query, describe, list, and export. There is no
 * create, update, delete, or bulk tool here, and because a declared subagent
 * inherits nothing from the root, there is no way for the analyst to reach one.
 *
 * Per-user Salesforce credentials are not resolved here either. The analyst
 * runs as a delegated child with no interactive channel, so it could not answer
 * a sign-in prompt; it reads with the service account, which is the correct
 * scope for read-only analysis.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { isConfigured } from "../../../lib/integrations"
import * as sf from "../../../lib/salesforce/client"
import { validateReadOnlySoql } from "../../../lib/soql"
import { writeCsvToWorkspace } from "../../../lib/workspace"

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
        query_salesforce: defineTool({
          description: `Run a read-only SOQL query. Returns up to ${INLINE_RECORD_LIMIT} rows inline plus the true total count.

For anything you intend to actually analyze, use export_salesforce_query instead and compute over the file.`,
          inputSchema: z.object({
            soql: z.string().describe("The SOQL query to run"),
          }),
          async execute({ soql }) {
            const check = validateReadOnlySoql(soql)
            if (!check.ok) {
              return {
                success: false as const,
                error: `Not a read-only query: ${check.reason}`,
              }
            }
            try {
              const records = await sf.queryAllRecords(soql)
              const truncated = records.length > INLINE_RECORD_LIMIT
              return {
                success: true as const,
                count: records.length,
                truncated,
                records: truncated
                  ? records.slice(0, INLINE_RECORD_LIMIT)
                  : records,
              }
            } catch (error) {
              return fail(error, "Query failed")
            }
          },
        }),

        export_salesforce_query: defineTool({
          description:
            "Run a SOQL query and write the full result set to a CSV in /workspace. Returns the path, row count, and columns. This is the tool to use before any real analysis.",
          inputSchema: z.object({
            soql: z.string().describe("The SOQL query to run"),
            label: z.string().describe("Short label for the filename"),
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
              const records = await sf.queryAllRecords(soql)
              const written = await writeCsvToWorkspace(ctx, records, label)
              return written
                ? { success: true as const, ...written }
                : {
                    success: true as const,
                    count: 0,
                    path: null,
                    note: "No rows, so no file was written.",
                  }
            } catch (error) {
              return fail(error, "Export failed")
            }
          },
        }),

        describe_salesforce_object: defineTool({
          description:
            "Get an object's fields — API names, labels, types, picklist values. Use name_filter to avoid pulling hundreds.",
          inputSchema: z.object({
            object_name: z.string().describe("The object API name"),
            name_filter: z
              .string()
              .optional()
              .describe("Only fields whose name or label contains this text"),
          }),
          async execute({ object_name, name_filter }) {
            try {
              const described = await sf.describeObject(object_name)
              type SfField = {
                name: string
                label: string
                type: string
                nillable: boolean
                picklistValues?: Array<{ value: string; active: boolean }>
              }
              const needle = name_filter?.toLowerCase()
              const fields = (described.fields as SfField[])
                .map((field) => ({
                  name: field.name,
                  label: field.label,
                  type: field.type,
                  required: !field.nillable,
                  values: field.picklistValues
                    ?.filter((option) => option.active)
                    .map((option) => option.value)
                    .slice(0, 25),
                }))
                .filter(
                  (field) =>
                    !needle ||
                    field.name.toLowerCase().includes(needle) ||
                    field.label.toLowerCase().includes(needle)
                )
              return {
                success: true as const,
                object_name: described.name,
                fields: fields.slice(0, 120),
              }
            } catch (error) {
              return fail(error, "Describe failed")
            }
          },
        }),

        list_salesforce_objects: defineTool({
          description: "List queryable objects in the org, to find an API name.",
          inputSchema: z.object({
            name_filter: z.string().optional(),
            custom_only: z.boolean().optional(),
          }),
          async execute({ name_filter, custom_only }) {
            try {
              const global = await sf.describeGlobal()
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
                .map((object) => ({ name: object.name, label: object.label }))
              return {
                success: true as const,
                count: objects.length,
                objects: objects.slice(0, 200),
              }
            } catch (error) {
              return fail(error, "Failed to list objects")
            }
          },
        }),
      }
    },
  },
})
