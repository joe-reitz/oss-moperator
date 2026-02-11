/**
 * HubSpot AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as hs from "./client"

export const hubspotTools = {
  // ─── Read Tools ───────────────────────────────────────────────────────────────

  searchHubSpotContacts: tool({
    description:
      "Search for contacts in HubSpot by name, email, or other query string. Returns matching contacts with key properties.",
    inputSchema: z.object({
      query: z.string().describe("Search query (name, email, company, etc.)"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to return"),
    }),
    execute: async ({ query, properties }) => {
      try {
        const results = await hs.searchContacts(query, properties)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Search failed",
        }
      }
    },
  }),

  getHubSpotContact: tool({
    description: "Get a single HubSpot contact by ID with its properties.",
    inputSchema: z.object({
      contactId: z.string().describe("The HubSpot contact ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to return"),
    }),
    execute: async ({ contactId, properties }) => {
      try {
        const result = await hs.getContact(contactId, properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Get contact failed",
        }
      }
    },
  }),

  searchHubSpotCompanies: tool({
    description:
      "Search for companies in HubSpot by name, domain, or other query string.",
    inputSchema: z.object({
      query: z.string().describe("Search query (company name, domain, etc.)"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to return"),
    }),
    execute: async ({ query, properties }) => {
      try {
        const results = await hs.searchCompanies(query, properties)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Search failed",
        }
      }
    },
  }),

  searchHubSpotDeals: tool({
    description:
      "Search for deals in HubSpot by name or other query string. Returns deal name, amount, stage, and close date.",
    inputSchema: z.object({
      query: z.string().describe("Search query (deal name, etc.)"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to return"),
    }),
    execute: async ({ query, properties }) => {
      try {
        const results = await hs.searchDeals(query, properties)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Search failed",
        }
      }
    },
  }),

  listHubSpotLists: tool({
    description: "List all contact lists in HubSpot.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await hs.getLists()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "List fetch failed",
        }
      }
    },
  }),

  getHubSpotListMembers: tool({
    description: "Get the members (contact IDs) of a HubSpot list.",
    inputSchema: z.object({
      listId: z.string().describe("The HubSpot list ID"),
    }),
    execute: async ({ listId }) => {
      try {
        const results = await hs.getListMembers(listId)
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Get members failed",
        }
      }
    },
  }),

  listHubSpotOwners: tool({
    description:
      "List all owners (users) in HubSpot. Useful for assigning contacts, companies, or deals.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await hs.listOwners()
        return { success: true as const, data: results }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "List owners failed",
        }
      }
    },
  }),

  // ─── Write Tools (gated) ─────────────────────────────────────────────────────

  createHubSpotContact: tool({
    description: "Create a new contact in HubSpot.",
    inputSchema: z.object({
      properties: z
        .record(z.string(), z.string())
        .describe(
          "Contact properties (e.g. firstname, lastname, email, company, phone)"
        ),
    }),
    execute: async ({ properties }) => {
      try {
        const result = await hs.createContact(properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Create contact failed",
        }
      }
    },
  }),

  updateHubSpotContact: tool({
    description: "Update an existing contact in HubSpot.",
    inputSchema: z.object({
      contactId: z.string().describe("The HubSpot contact ID"),
      properties: z
        .record(z.string(), z.string())
        .describe("Properties to update"),
    }),
    execute: async ({ contactId, properties }) => {
      try {
        const result = await hs.updateContact(contactId, properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Update contact failed",
        }
      }
    },
  }),

  deleteHubSpotContact: tool({
    description: "Delete a contact from HubSpot.",
    inputSchema: z.object({
      contactId: z.string().describe("The HubSpot contact ID to delete"),
    }),
    execute: async ({ contactId }) => {
      try {
        await hs.deleteContact(contactId)
        return {
          success: true as const,
          message: `Deleted HubSpot contact ${contactId}`,
        }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Delete contact failed",
        }
      }
    },
  }),

  createHubSpotCompany: tool({
    description: "Create a new company in HubSpot.",
    inputSchema: z.object({
      properties: z
        .record(z.string(), z.string())
        .describe(
          "Company properties (e.g. name, domain, industry, city, numberofemployees)"
        ),
    }),
    execute: async ({ properties }) => {
      try {
        const result = await hs.createCompany(properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Create company failed",
        }
      }
    },
  }),

  updateHubSpotCompany: tool({
    description: "Update an existing company in HubSpot.",
    inputSchema: z.object({
      companyId: z.string().describe("The HubSpot company ID"),
      properties: z
        .record(z.string(), z.string())
        .describe("Properties to update"),
    }),
    execute: async ({ companyId, properties }) => {
      try {
        const result = await hs.updateCompany(companyId, properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Update company failed",
        }
      }
    },
  }),

  createHubSpotDeal: tool({
    description: "Create a new deal in HubSpot.",
    inputSchema: z.object({
      properties: z
        .record(z.string(), z.string())
        .describe(
          "Deal properties (e.g. dealname, amount, dealstage, closedate, pipeline)"
        ),
    }),
    execute: async ({ properties }) => {
      try {
        const result = await hs.createDeal(properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Create deal failed",
        }
      }
    },
  }),

  updateHubSpotDeal: tool({
    description: "Update an existing deal in HubSpot.",
    inputSchema: z.object({
      dealId: z.string().describe("The HubSpot deal ID"),
      properties: z
        .record(z.string(), z.string())
        .describe("Properties to update"),
    }),
    execute: async ({ dealId, properties }) => {
      try {
        const result = await hs.updateDeal(dealId, properties)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Update deal failed",
        }
      }
    },
  }),

  addToHubSpotList: tool({
    description: "Add contacts to a HubSpot list by their record IDs.",
    inputSchema: z.object({
      listId: z.string().describe("The HubSpot list ID"),
      recordIds: z
        .array(z.string())
        .describe("Array of contact record IDs to add"),
    }),
    execute: async ({ listId, recordIds }) => {
      try {
        const result = await hs.addToList(listId, recordIds)
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

  removeFromHubSpotList: tool({
    description: "Remove contacts from a HubSpot list by their record IDs.",
    inputSchema: z.object({
      listId: z.string().describe("The HubSpot list ID"),
      recordIds: z
        .array(z.string())
        .describe("Array of contact record IDs to remove"),
    }),
    execute: async ({ listId, recordIds }) => {
      try {
        const result = await hs.removeFromList(listId, recordIds)
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
}
