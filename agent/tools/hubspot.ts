/**
 * HubSpot tools.
 *
 * Reads are open; every write is gated by the shared approval policies, and
 * list-membership changes go through `bulkApproval` so a stray "add everyone
 * to the nurture list" gets sized and confirmed before it lands.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, deleteApproval, writeApproval } from "../lib/approval"
import * as hs from "../lib/hubspot/client"
import { isConfigured } from "../lib/integrations"

function ok(data: unknown) {
  return { success: true as const, data }
}

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

const properties = z
  .array(z.string())
  .optional()
  .describe("Property names to return. Omit for HubSpot's defaults.")

/**
 * HubSpot property values go over the wire as strings — numbers, booleans, and
 * dates included. Accept the natural JSON types from the model and coerce here
 * rather than making it remember to quote everything.
 */
const propertyValues = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .describe("Property API names mapped to values")

function toHubspotProperties(
  input: Record<string, string | number | boolean | null>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    // An explicit null is how HubSpot clears a property, and it must be sent
    // as an empty string rather than omitted.
    out[key] = value === null ? "" : String(value)
  }
  return out
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("hubspot")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        search_hubspot_contacts: defineTool({
          description:
            "Search HubSpot contacts by name, email, or company. Returns matching contacts with their key properties.",
          inputSchema: z.object({
            query: z.string().describe("Search text — a name, email, or company"),
            properties,
          }),
          async execute({ query, properties }) {
            try {
              return ok(await hs.searchContacts(query, properties))
            } catch (error) {
              return fail(error, "Contact search failed")
            }
          },
        }),

        get_hubspot_contact: defineTool({
          description: "Get one HubSpot contact by ID, with its properties.",
          inputSchema: z.object({
            contact_id: z.string().describe("The HubSpot contact ID"),
            properties,
          }),
          async execute({ contact_id, properties }) {
            try {
              return ok(await hs.getContact(contact_id, properties))
            } catch (error) {
              return fail(error, "Failed to get contact")
            }
          },
        }),

        search_hubspot_companies: defineTool({
          description: "Search HubSpot companies by name or domain.",
          inputSchema: z.object({
            query: z.string().describe("Search text — a company name or domain"),
            properties,
          }),
          async execute({ query, properties }) {
            try {
              return ok(await hs.searchCompanies(query, properties))
            } catch (error) {
              return fail(error, "Company search failed")
            }
          },
        }),

        search_hubspot_deals: defineTool({
          description:
            "Search HubSpot deals. Returns deal name, amount, stage, and close date.",
          inputSchema: z.object({
            query: z.string().describe("Search text — a deal name"),
            properties,
          }),
          async execute({ query, properties }) {
            try {
              return ok(await hs.searchDeals(query, properties))
            } catch (error) {
              return fail(error, "Deal search failed")
            }
          },
        }),

        list_hubspot_lists: defineTool({
          description:
            "List the contact lists in HubSpot, with their IDs. Call this before changing list membership so you use the right list.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await hs.getLists())
            } catch (error) {
              return fail(error, "Failed to list lists")
            }
          },
        }),

        get_hubspot_list_members: defineTool({
          description: "Get the contact IDs belonging to a HubSpot list.",
          inputSchema: z.object({
            list_id: z.string().describe("The HubSpot list ID"),
          }),
          async execute({ list_id }) {
            try {
              return ok(await hs.getListMembers(list_id))
            } catch (error) {
              return fail(error, "Failed to get list members")
            }
          },
        }),

        list_hubspot_owners: defineTool({
          description:
            "List HubSpot owners (users), so you can assign a record to the right person.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await hs.listOwners())
            } catch (error) {
              return fail(error, "Failed to list owners")
            }
          },
        }),

        // ── Write ───────────────────────────────────────────────────────────

        create_hubspot_contact: defineTool({
          description:
            "Create a HubSpot contact. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            properties: propertyValues.describe(
              "Contact properties, e.g. { email, firstname, lastname }"
            ),
          }),
          approval: writeApproval(),
          async execute({ properties }) {
            try {
              return ok(await hs.createContact(toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to create contact")
            }
          },
        }),

        update_hubspot_contact: defineTool({
          description:
            "Update a HubSpot contact. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            contact_id: z.string().describe("The HubSpot contact ID"),
            properties: propertyValues,
          }),
          approval: writeApproval(),
          async execute({ contact_id, properties }) {
            try {
              return ok(await hs.updateContact(contact_id, toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to update contact")
            }
          },
        }),

        delete_hubspot_contact: defineTool({
          description:
            "Delete a HubSpot contact. Always requires approval and never runs from a scheduled task.",
          inputSchema: z.object({
            contact_id: z.string().describe("The HubSpot contact ID"),
          }),
          approval: deleteApproval(),
          async execute({ contact_id }) {
            try {
              return ok(await hs.deleteContact(contact_id))
            } catch (error) {
              return fail(error, "Failed to delete contact")
            }
          },
        }),

        create_hubspot_company: defineTool({
          description:
            "Create a HubSpot company. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            properties: propertyValues.describe(
              "Company properties, e.g. { name, domain }"
            ),
          }),
          approval: writeApproval(),
          async execute({ properties }) {
            try {
              return ok(await hs.createCompany(toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to create company")
            }
          },
        }),

        update_hubspot_company: defineTool({
          description:
            "Update a HubSpot company. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            company_id: z.string().describe("The HubSpot company ID"),
            properties: propertyValues,
          }),
          approval: writeApproval(),
          async execute({ company_id, properties }) {
            try {
              return ok(await hs.updateCompany(company_id, toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to update company")
            }
          },
        }),

        create_hubspot_deal: defineTool({
          description:
            "Create a HubSpot deal. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            properties: propertyValues.describe(
              "Deal properties, e.g. { dealname, amount, dealstage }"
            ),
          }),
          approval: writeApproval(),
          async execute({ properties }) {
            try {
              return ok(await hs.createDeal(toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to create deal")
            }
          },
        }),

        update_hubspot_deal: defineTool({
          description:
            "Update a HubSpot deal — stage, amount, close date. Requires approval unless the caller is an approver.",
          inputSchema: z.object({
            deal_id: z.string().describe("The HubSpot deal ID"),
            properties: propertyValues,
          }),
          approval: writeApproval(),
          async execute({ deal_id, properties }) {
            try {
              return ok(await hs.updateDeal(deal_id, toHubspotProperties(properties)))
            } catch (error) {
              return fail(error, "Failed to update deal")
            }
          },
        }),

        add_to_hubspot_list: defineTool({
          description:
            "Add records to a HubSpot static list. State how many records you are adding and to which list before calling. Large batches always require approval.",
          inputSchema: z.object({
            list_id: z.string().describe("The HubSpot list ID"),
            record_ids: z.array(z.string()).min(1).describe("Record IDs to add"),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.record_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ list_id, record_ids }) {
            try {
              return ok(await hs.addToList(list_id, record_ids))
            } catch (error) {
              return fail(error, "Failed to add to list")
            }
          },
        }),

        remove_from_hubspot_list: defineTool({
          description:
            "Remove records from a HubSpot static list. Large batches always require approval.",
          inputSchema: z.object({
            list_id: z.string().describe("The HubSpot list ID"),
            record_ids: z.array(z.string()).min(1).describe("Record IDs to remove"),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.record_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ list_id, record_ids }) {
            try {
              return ok(await hs.removeFromList(list_id, record_ids))
            } catch (error) {
              return fail(error, "Failed to remove from list")
            }
          },
        }),
      }
    },
  },
})
