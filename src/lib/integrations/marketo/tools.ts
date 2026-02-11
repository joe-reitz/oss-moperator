/**
 * Marketo AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as mk from "./client"

export const marketoTools = {
  // ─── Read Tools ───────────────────────────────────────────────────────────────

  searchMarketoLeads: tool({
    description:
      "Search for leads in Marketo by a filter field (e.g. email, company, id). Returns matching lead records.",
    inputSchema: z.object({
      filterType: z
        .string()
        .describe(
          "The lead field to filter by (e.g. 'email', 'company', 'id')"
        ),
      filterValues: z
        .array(z.string())
        .describe("Values to match against the filter field"),
    }),
    execute: async ({ filterType, filterValues }) => {
      try {
        const results = await mk.getLeads(filterType, filterValues)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Search failed",
        }
      }
    },
  }),

  getMarketoLead: tool({
    description: "Get a single Marketo lead by ID.",
    inputSchema: z.object({
      leadId: z.string().describe("The Marketo lead ID"),
    }),
    execute: async ({ leadId }) => {
      try {
        const result = await mk.getLead(leadId)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Get lead failed",
        }
      }
    },
  }),

  describeMarketoLeadFields: tool({
    description:
      "Describe the available fields on the Marketo lead object. Use this to understand what fields are available before creating or updating leads.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await mk.describeLeads()
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Describe failed",
        }
      }
    },
  }),

  listMarketoLists: tool({
    description: "List all static lists in Marketo.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await mk.getLists()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "List fetch failed",
        }
      }
    },
  }),

  getMarketoListLeads: tool({
    description: "Get all leads that are members of a specific Marketo list.",
    inputSchema: z.object({
      listId: z.string().describe("The Marketo list ID"),
    }),
    execute: async ({ listId }) => {
      try {
        const results = await mk.getListLeads(listId)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Get leads failed",
        }
      }
    },
  }),

  listMarketoCampaigns: tool({
    description:
      "List all trigger campaigns in Marketo. Only trigger (not batch) campaigns can be requested via the API.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await mk.getCampaigns()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "List campaigns failed",
        }
      }
    },
  }),

  listMarketoPrograms: tool({
    description: "List programs in Marketo (email programs, engagement programs, events, etc.).",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await mk.getPrograms()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "List programs failed",
        }
      }
    },
  }),

  listMarketoEmails: tool({
    description: "List email assets in Marketo.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await mk.getEmails()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "List emails failed",
        }
      }
    },
  }),

  // ─── Write Tools (gated) ─────────────────────────────────────────────────────

  createOrUpdateMarketoLeads: tool({
    description:
      "Create or update leads in Marketo. Pass an array of lead objects. The action parameter controls behavior: createOnly, updateOnly, or createOrUpdate (default).",
    inputSchema: z.object({
      leads: z
        .array(z.record(z.string(), z.unknown()))
        .describe(
          "Array of lead objects with field names and values (e.g. email, firstName, lastName, company)"
        ),
      action: z
        .enum(["createOnly", "updateOnly", "createOrUpdate"])
        .optional()
        .describe("Action type (default: createOrUpdate)"),
    }),
    execute: async ({ leads, action }) => {
      try {
        const result = await mk.createOrUpdateLeads(leads, action)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error
              ? error.message
              : "Create/update leads failed",
        }
      }
    },
  }),

  deleteMarketoLead: tool({
    description: "Delete a lead from Marketo by ID.",
    inputSchema: z.object({
      leadId: z.string().describe("The Marketo lead ID to delete"),
    }),
    execute: async ({ leadId }) => {
      try {
        const result = await mk.deleteLead(leadId)
        return {
          success: true as const,
          data: result,
          message: `Deleted Marketo lead ${leadId}`,
        }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Delete lead failed",
        }
      }
    },
  }),

  addLeadsToMarketoList: tool({
    description: "Add leads to a Marketo static list.",
    inputSchema: z.object({
      listId: z.string().describe("The Marketo list ID"),
      leadIds: z.array(z.string()).describe("Array of lead IDs to add"),
    }),
    execute: async ({ listId, leadIds }) => {
      try {
        const result = await mk.addLeadsToList(listId, leadIds)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Add to list failed",
        }
      }
    },
  }),

  removeLeadsFromMarketoList: tool({
    description: "Remove leads from a Marketo static list.",
    inputSchema: z.object({
      listId: z.string().describe("The Marketo list ID"),
      leadIds: z.array(z.string()).describe("Array of lead IDs to remove"),
    }),
    execute: async ({ listId, leadIds }) => {
      try {
        const result = await mk.removeLeadsFromList(listId, leadIds)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error
              ? error.message
              : "Remove from list failed",
        }
      }
    },
  }),

  triggerMarketoCampaign: tool({
    description:
      "Trigger a Marketo smart campaign for specific leads. Only works with trigger campaigns that have a 'Campaign is Requested' trigger.",
    inputSchema: z.object({
      campaignId: z.string().describe("The Marketo campaign ID"),
      leadIds: z
        .array(z.string())
        .describe("Array of lead IDs to process through the campaign"),
      tokens: z
        .array(
          z.object({
            name: z.string().describe("Token name (e.g. '{{my.tokenName}}')"),
            value: z.string().describe("Token value"),
          })
        )
        .optional()
        .describe("Optional My Tokens to override for this campaign run"),
    }),
    execute: async ({ campaignId, leadIds, tokens }) => {
      try {
        const result = await mk.triggerCampaign(campaignId, leadIds, tokens)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error
              ? error.message
              : "Trigger campaign failed",
        }
      }
    },
  }),
}
