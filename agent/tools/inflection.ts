/**
 * Inflection tools.
 *
 * No send tool here, deliberately. Inflection's public API (V1) covers contacts,
 * lists, activity, and email *objects* — it does not expose "send this now", so
 * there is nothing to wrap in `externalSendApproval()`. Journeys do the sending,
 * and they are driven from the app. Adding list members is the step that makes
 * someone reachable by a journey, so that is the tool to read carefully.
 *
 * Contact writes are asynchronous: the API returns a transaction to poll. The
 * client polls briefly and reports the per-contact outcomes, so the model gets
 * "3 created, 1 updated, 1 failed" rather than an opaque transaction id.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, writeApproval } from "../lib/approval"
import { isConfigured } from "../lib/integrations"
import * as inf from "../lib/inflection/client"

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
      if (!isConfigured("inflection")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        get_inflection_contact: defineTool({
          description:
            "Look up one Inflection contact by email address or by contact id. Returns the contact's properties.",
          inputSchema: z.object({
            email: z
              .string()
              .optional()
              .describe("The contact's email. Provide this or contact_id."),
            contact_id: z.string().optional().describe("The Inflection contact id"),
          }),
          async execute({ email, contact_id }) {
            try {
              if (!email && !contact_id) {
                return {
                  success: false as const,
                  error: "Provide either an email or a contact_id.",
                }
              }
              return ok(
                email
                  ? await inf.getContactByEmail(email)
                  : await inf.getContactById(contact_id as string)
              )
            } catch (error) {
              return fail(error, "Contact lookup failed")
            }
          },
        }),

        get_inflection_contact_activity: defineTool({
          description: `Read a contact's activity history in Inflection. Three kinds, and they answer different questions:

- marketing: emails sent, opened, clicked — what we did to them
- product: in-product behaviour streamed from the warehouse or CDP — what they did
- log: the combined chronological record

Needs a contact_id, so call get_inflection_contact first if you only have an email.`,
          inputSchema: z.object({
            contact_id: z.string().describe("The Inflection contact id"),
            kind: z
              .enum(["marketing", "product", "log"])
              .describe("Which activity stream to read"),
          }),
          async execute({ contact_id, kind }) {
            try {
              if (kind === "marketing") {
                return ok(await inf.getMarketingActivity(contact_id))
              }
              if (kind === "product") {
                return ok(await inf.getProductActivity(contact_id))
              }
              return ok(await inf.getActivityLog(contact_id))
            } catch (error) {
              return fail(error, "Failed to read activity")
            }
          },
        }),

        get_inflection_list: defineTool({
          description: "Get one Inflection list by id — its name and description.",
          inputSchema: z.object({
            list_id: z.string().describe("The list id"),
          }),
          async execute({ list_id }) {
            try {
              return ok(await inf.getList(list_id))
            } catch (error) {
              return fail(error, "Failed to get list")
            }
          },
        }),

        get_inflection_list_members: defineTool({
          description:
            "List the contacts on an Inflection list. Paged — pass page_number and page_size for large lists, and read the returned pagination to know whether more remain.",
          inputSchema: z.object({
            list_id: z.string().describe("The list id"),
            page_number: z.number().int().min(0).optional(),
            page_size: z.number().int().min(1).max(500).optional(),
          }),
          async execute({ list_id, page_number, page_size }) {
            try {
              return ok(await inf.getListMembers(list_id, page_number, page_size))
            } catch (error) {
              return fail(error, "Failed to read list members")
            }
          },
        }),

        get_inflection_transaction: defineTool({
          description:
            "Check the status of an Inflection contact-write transaction. Use this when a write came back still PENDING — it reports DONE with per-contact outcomes once the batch has landed.",
          inputSchema: z.object({
            transaction_id: z
              .string()
              .describe("The transactionId returned by a contact write"),
          }),
          async execute({ transaction_id }) {
            try {
              return ok(await inf.getTransaction(transaction_id))
            } catch (error) {
              return fail(error, "Failed to read transaction")
            }
          },
        }),

        // ── Write ───────────────────────────────────────────────────────────

        upsert_inflection_contacts: defineTool({
          description: `Create or update Inflection contacts by email. Existing addresses are updated, new ones created.

Property keys MUST be snake_case — first_name, not firstName. Inflection silently stores camelCase keys as null, so the call is refused up front if any are camelCase rather than letting the data go missing.

Writes are asynchronous: the result reports per-contact outcomes (CREATED, UPDATED, NO_CHANGE, FAILED) once the transaction completes. If it is still PENDING, use get_inflection_transaction with the returned id. Maximum 1,000 contacts per call.`,
          inputSchema: z.object({
            contacts: z
              .array(
                z.object({
                  email: z.string().describe("The contact's email address"),
                  properties: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe(
                      "snake_case properties, e.g. { first_name, last_name, company_name }"
                    ),
                })
              )
              .min(1)
              .max(inf.MAX_BATCH)
              .describe("Contacts to create or update"),
          }),
          approval: bulkApproval((input) => {
            const contacts = input?.contacts
            return Array.isArray(contacts) ? contacts.length : 0
          }),
          async execute({ contacts }) {
            try {
              const result = await inf.upsertContacts(contacts)
              const outcomes = result.transaction.results

              const summary = outcomes
                ? Object.entries(
                    outcomes.reduce<Record<string, number>>((acc, r) => {
                      const key = r.status || "UNKNOWN"
                      acc[key] = (acc[key] || 0) + 1
                      return acc
                    }, {})
                  )
                    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
                    .join(", ")
                : `still pending — check transaction ${result.transaction.transactionId}`

              return { ...ok(result), message: `${contacts.length} contacts: ${summary}` }
            } catch (error) {
              return fail(error, "Contact upsert failed")
            }
          },
        }),

        create_inflection_list: defineTool({
          description: "Create a new Inflection list.",
          inputSchema: z.object({
            name: z.string().describe("List name"),
            description: z.string().optional().describe("What the list is for"),
          }),
          approval: writeApproval(),
          async execute({ name, description }) {
            try {
              return ok(await inf.createList(name, description))
            } catch (error) {
              return fail(error, "Failed to create list")
            }
          },
        }),

        add_inflection_list_members: defineTool({
          description: `Add contacts to an Inflection list by CONTACT ID — not by email. Look ids up with get_inflection_contact first.

List membership is what makes someone reachable by a journey, so treat this as a step towards sending.

Ids that cannot be resolved are skipped rather than failing the call, and reported as warnings — so check the warnings to confirm everyone actually landed.`,
          inputSchema: z.object({
            list_id: z.string().describe("The list id"),
            contact_ids: z
              .array(z.string())
              .min(1)
              .describe("Inflection contact ids to add"),
          }),
          approval: bulkApproval((input) => {
            const ids = input?.contact_ids
            return Array.isArray(ids) ? ids.length : 0
          }),
          async execute({ list_id, contact_ids }) {
            try {
              const result = await inf.addListMembers(list_id, contact_ids)
              return {
                ...ok(result),
                message: `Added ${contact_ids.length} contacts to list ${list_id}${
                  result.warnings ? ` (some skipped: ${result.warnings})` : ""
                }`,
              }
            } catch (error) {
              return fail(error, "Failed to add list members")
            }
          },
        }),

        remove_inflection_list_member: defineTool({
          description:
            "Remove one contact from an Inflection list, by contact id. Removes list membership only — the contact record itself is untouched.",
          inputSchema: z.object({
            list_id: z.string().describe("The list id"),
            contact_id: z.string().describe("The contact id to remove"),
          }),
          approval: writeApproval(),
          async execute({ list_id, contact_id }) {
            try {
              return ok(await inf.removeListMember(list_id, contact_id))
            } catch (error) {
              return fail(error, "Failed to remove list member")
            }
          },
        }),
      }
    },
  },
})
