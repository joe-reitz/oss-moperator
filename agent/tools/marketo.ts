/**
 * Marketo tools.
 *
 * `trigger_marketo_campaign` is the one tool in this repo that can put email in
 * front of real people, so it carries `externalSendApproval()`: always a human,
 * and never from a scheduled task — a replayed step must not be able to re-send
 * a campaign.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import {
  bulkApproval,
  deleteApproval,
  externalSendApproval,
  writeApproval,
} from "../lib/approval"
import { isConfigured } from "../lib/integrations"
import * as mk from "../lib/marketo/client"

function ok(data: unknown) {
  return { success: true as const, data }
}

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("marketo")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        search_marketo_leads: defineTool({
          description:
            "Look up Marketo leads by a filter field and values, e.g. filter_type 'email' with a list of addresses. Use describe_marketo_lead_fields when unsure which fields are filterable.",
          inputSchema: z.object({
            filter_type: z
              .string()
              .describe("Field to filter on, e.g. email, id, or a custom field"),
            filter_values: z.array(z.string()).min(1).describe("Values to match"),
            fields: z
              .array(z.string())
              .optional()
              .describe("Lead fields to return. Omit for Marketo's defaults."),
          }),
          async execute({ filter_type, filter_values, fields }) {
            try {
              return ok(await mk.getLeads(filter_type, filter_values, fields))
            } catch (error) {
              return fail(error, "Lead search failed")
            }
          },
        }),

        get_marketo_lead: defineTool({
          description: "Get one Marketo lead by ID.",
          inputSchema: z.object({
            lead_id: z.string().describe("The Marketo lead ID"),
          }),
          async execute({ lead_id }) {
            try {
              return ok(await mk.getLead(lead_id))
            } catch (error) {
              return fail(error, "Failed to get lead")
            }
          },
        }),

        describe_marketo_lead_fields: defineTool({
          description:
            "List the Marketo lead fields — API names, display names, and types. Call this before writing leads so you use real field names.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await mk.describeLeads())
            } catch (error) {
              return fail(error, "Describe failed")
            }
          },
        }),

        list_marketo_lists: defineTool({
          description: "List Marketo static lists with their IDs.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await mk.getLists())
            } catch (error) {
              return fail(error, "Failed to list lists")
            }
          },
        }),

        get_marketo_list_leads: defineTool({
          description: "Get the leads in a Marketo static list.",
          inputSchema: z.object({
            list_id: z.string().describe("The Marketo list ID"),
          }),
          async execute({ list_id }) {
            try {
              return ok(await mk.getListLeads(list_id))
            } catch (error) {
              return fail(error, "Failed to get list leads")
            }
          },
        }),

        list_marketo_campaigns: defineTool({
          description:
            "List Marketo smart campaigns with their IDs and whether each is a trigger campaign. Only trigger campaigns with a 'Campaign is Requested' trigger can be fired by trigger_marketo_campaign.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await mk.getCampaigns())
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        list_marketo_programs: defineTool({
          description: "List Marketo programs with their channels and statuses.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await mk.getPrograms())
            } catch (error) {
              return fail(error, "Failed to list programs")
            }
          },
        }),

        list_marketo_emails: defineTool({
          description: "List Marketo email assets with their IDs and statuses.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await mk.getEmails())
            } catch (error) {
              return fail(error, "Failed to list emails")
            }
          },
        }),

        // ── Write ───────────────────────────────────────────────────────────

        upsert_marketo_leads: defineTool({
          description:
            "Create or update Marketo leads. `action` controls whether existing leads may be modified. Large batches always require approval.",
          inputSchema: z.object({
            leads: z
              .array(z.record(z.string(), z.unknown()))
              .min(1)
              .describe(
                "Lead objects keyed by Marketo field name, e.g. { email, firstName, lastName, company }"
              ),
            action: z
              .enum(["createOnly", "updateOnly", "createOrUpdate"])
              .optional()
              .describe("Defaults to createOrUpdate"),
          }),
          approval: bulkApproval((input) => {
            const leads = input?.leads
            return Array.isArray(leads) ? leads.length : 0
          }),
          async execute({ leads, action }) {
            try {
              return ok(await mk.createOrUpdateLeads(leads, action))
            } catch (error) {
              return fail(error, "Lead upsert failed")
            }
          },
        }),

        delete_marketo_lead: defineTool({
          description:
            "Delete a Marketo lead by ID. Always requires approval and never runs from a scheduled task.",
          inputSchema: z.object({
            lead_id: z.string().describe("The Marketo lead ID"),
          }),
          approval: deleteApproval(),
          async execute({ lead_id }) {
            try {
              return {
                ...ok(await mk.deleteLead(lead_id)),
                message: `Deleted Marketo lead ${lead_id}`,
              }
            } catch (error) {
              return fail(error, "Delete failed")
            }
          },
        }),

        add_leads_to_marketo_list: defineTool({
          description:
            "Add leads to a Marketo static list. State the count and the list before calling. Large batches always require approval.",
          inputSchema: z.object({
            list_id: z.string().describe("The Marketo list ID"),
            lead_ids: z.array(z.string()).min(1).describe("Lead IDs to add"),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.lead_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ list_id, lead_ids }) {
            try {
              return ok(await mk.addLeadsToList(list_id, lead_ids))
            } catch (error) {
              return fail(error, "Failed to add leads to list")
            }
          },
        }),

        remove_leads_from_marketo_list: defineTool({
          description:
            "Remove leads from a Marketo static list. Large batches always require approval.",
          inputSchema: z.object({
            list_id: z.string().describe("The Marketo list ID"),
            lead_ids: z.array(z.string()).min(1).describe("Lead IDs to remove"),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.lead_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ list_id, lead_ids }) {
            try {
              return ok(await mk.removeLeadsFromList(list_id, lead_ids))
            } catch (error) {
              return fail(error, "Failed to remove leads from list")
            }
          },
        }),

        trigger_marketo_campaign: defineTool({
          description: `Fire a Marketo trigger campaign for specific leads. This SENDS — treat it as irreversible.

Only works on campaigns with a "Campaign is Requested" trigger; call list_marketo_campaigns first to confirm the campaign is a trigger campaign.

Before calling: state the campaign name, the exact lead count, and what those people will receive. Always requires human approval, and cannot run from a scheduled task.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The Marketo campaign ID"),
            lead_ids: z
              .array(z.string())
              .min(1)
              .describe("Lead IDs to run through the campaign"),
            tokens: z
              .array(
                z.object({
                  name: z.string().describe("Token name, e.g. {{my.eventDate}}"),
                  value: z.string().describe("Token value"),
                })
              )
              .optional()
              .describe("My Tokens to override for this run"),
          }),
          approval: externalSendApproval(),
          async execute({ campaign_id, lead_ids, tokens }) {
            try {
              return {
                ...ok(await mk.triggerCampaign(campaign_id, lead_ids, tokens)),
                message: `Triggered campaign ${campaign_id} for ${lead_ids.length} leads`,
              }
            } catch (error) {
              return fail(error, "Failed to trigger campaign")
            }
          },
        }),
      }
    },
  },
})
