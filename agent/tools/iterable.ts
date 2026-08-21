/**
 * Iterable tools.
 *
 * `send_iterable_email` is the one tool here that reaches a real inbox, so it
 * carries `externalSendApproval()`.
 *
 * The identity model is worth stating in the tool descriptions rather than only
 * in docs: Iterable keys profiles on email by default, and mixing email-keyed
 * and userId-keyed writes for the same person creates two profiles. The model
 * cannot infer which convention a workspace uses, so it is told to stay
 * consistent with whatever it finds.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, externalSendApproval, writeApproval } from "../lib/approval"
import { isConfigured } from "../lib/integrations"
import * as it from "../lib/iterable/client"

function ok(data: unknown) {
  return { success: true as const, data }
}

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

function countOf(key: string) {
  return (input: Record<string, unknown> | undefined) => {
    const value = input?.[key]
    return Array.isArray(value) ? value.length : 0
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("iterable")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        get_iterable_user: defineTool({
          description:
            "Look up one Iterable user by email, with their dataFields and list subscriptions.",
          inputSchema: z.object({
            email: z.string().describe("The user's email address"),
          }),
          async execute({ email }) {
            try {
              return ok(await it.getUserByEmail(email))
            } catch (error) {
              return fail(error, "User lookup failed")
            }
          },
        }),

        list_iterable_lists: defineTool({
          description:
            "List Iterable lists — id, name, type, and size. Static lists accept membership changes; dynamic ones do not.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await it.listLists())
            } catch (error) {
              return fail(error, "Failed to list lists")
            }
          },
        }),

        get_iterable_list_users: defineTool({
          description:
            "Get the email addresses on an Iterable list, plus a count. This returns every address on the list, so for a large list prefer reporting the count from list_iterable_lists instead of pulling the whole membership.",
          inputSchema: z.object({
            list_id: z.union([z.number(), z.string()]).describe("The list id"),
          }),
          async execute({ list_id }) {
            try {
              return ok(await it.getListUsers(list_id))
            } catch (error) {
              return fail(error, "Failed to read list membership")
            }
          },
        }),

        list_iterable_campaigns: defineTool({
          description: "List Iterable campaigns with their state and type.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await it.listCampaigns())
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        get_iterable_campaign_metrics: defineTool({
          description:
            "Get delivery and engagement metrics for one or more Iterable campaigns over an optional date range.",
          inputSchema: z.object({
            campaign_ids: z
              .array(z.union([z.number(), z.string()]))
              .min(1)
              .describe("Campaign ids to report on"),
            start_date_time: z
              .string()
              .optional()
              .describe("Start of the range, e.g. 2026-01-01"),
            end_date_time: z.string().optional().describe("End of the range"),
          }),
          async execute({ campaign_ids, start_date_time, end_date_time }) {
            try {
              return ok(
                await it.getCampaignMetrics(
                  campaign_ids,
                  start_date_time,
                  end_date_time
                )
              )
            } catch (error) {
              return fail(error, "Failed to read campaign metrics")
            }
          },
        }),

        list_iterable_templates: defineTool({
          description: "List Iterable message templates.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await it.listTemplates())
            } catch (error) {
              return fail(error, "Failed to list templates")
            }
          },
        }),

        // ── Write ───────────────────────────────────────────────────────────

        update_iterable_user: defineTool({
          description: `Create or update one Iterable user. This is an upsert — an unknown email creates a profile.

Two things to respect: stay consistent with how the workspace identifies people (email or userId — mixing them for one person creates two profiles), and note that Iterable fixes a field's type on first write, so a field previously written as text will reject a number.`,
          inputSchema: z.object({
            email: z
              .string()
              .optional()
              .describe("The user's email. Provide this or user_id."),
            user_id: z
              .string()
              .optional()
              .describe("The user's userId, for workspaces keyed on userId"),
            data_fields: z
              .record(z.string(), z.unknown())
              .describe("Fields to set, e.g. { firstName, company, plan }"),
            prefer_user_id: z
              .boolean()
              .optional()
              .describe("Treat user_id as the primary key"),
          }),
          approval: writeApproval(),
          async execute({ email, user_id, data_fields, prefer_user_id }) {
            try {
              return ok(
                await it.updateUser({
                  email,
                  userId: user_id,
                  dataFields: data_fields,
                  preferUserId: prefer_user_id,
                })
              )
            } catch (error) {
              return fail(error, "Failed to update user")
            }
          },
        }),

        bulk_update_iterable_users: defineTool({
          description:
            "Create or update many Iterable users at once. Chunked at Iterable's 1,000-per-call limit automatically — do not split the input yourself.",
          inputSchema: z.object({
            users: z
              .array(
                z.object({
                  email: z.string().optional(),
                  user_id: z.string().optional(),
                  data_fields: z.record(z.string(), z.unknown()),
                })
              )
              .min(1)
              .describe("The users to write"),
          }),
          approval: bulkApproval(countOf("users")),
          async execute({ users }) {
            try {
              return {
                ...ok(
                  await it.bulkUpdateUsers(
                    users.map((u) => ({
                      email: u.email,
                      userId: u.user_id,
                      dataFields: u.data_fields,
                    }))
                  )
                ),
                message: `Wrote ${users.length} Iterable users`,
              }
            } catch (error) {
              return fail(error, "Bulk user update failed")
            }
          },
        }),

        subscribe_to_iterable_list: defineTool({
          description: `Add people to a static Iterable list by email. Creates users who do not exist yet.

Being on a list is what makes someone reachable by campaigns targeting it, so this is a step towards sending even though it does not itself send. Chunked at 1,000 per call automatically.`,
          inputSchema: z.object({
            list_id: z.union([z.number(), z.string()]).describe("The static list id"),
            emails: z.array(z.string()).min(1).describe("Email addresses to add"),
          }),
          approval: bulkApproval(countOf("emails")),
          async execute({ list_id, emails }) {
            try {
              return {
                ...ok(await it.subscribeToList(list_id, emails)),
                message: `Subscribed ${emails.length} people to list ${list_id}`,
              }
            } catch (error) {
              return fail(error, "Failed to subscribe to list")
            }
          },
        }),

        unsubscribe_from_iterable_list: defineTool({
          description:
            "Remove people from an Iterable list by email. Chunked at 1,000 per call automatically.",
          inputSchema: z.object({
            list_id: z.union([z.number(), z.string()]).describe("The list id"),
            emails: z.array(z.string()).min(1).describe("Email addresses to remove"),
          }),
          approval: bulkApproval(countOf("emails")),
          async execute({ list_id, emails }) {
            try {
              return {
                ...ok(await it.unsubscribeFromList(list_id, emails)),
                message: `Unsubscribed ${emails.length} people from list ${list_id}`,
              }
            } catch (error) {
              return fail(error, "Failed to unsubscribe from list")
            }
          },
        }),

        track_iterable_event: defineTool({
          description:
            "Record a custom event for an Iterable user. Events can trigger journeys, so this may cause sending downstream even though it is not itself a send.",
          inputSchema: z.object({
            email: z.string().optional().describe("The user's email"),
            user_id: z.string().optional().describe("The user's userId"),
            event_name: z.string().describe("Event name"),
            data_fields: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Event properties"),
          }),
          approval: writeApproval(),
          async execute({ email, user_id, event_name, data_fields }) {
            try {
              return ok(
                await it.trackEvent({
                  email,
                  userId: user_id,
                  eventName: event_name,
                  dataFields: data_fields,
                })
              )
            } catch (error) {
              return fail(error, "Failed to track event")
            }
          },
        }),

        // ── Send ────────────────────────────────────────────────────────────

        send_iterable_email: defineTool({
          description: `Send an existing Iterable campaign's email to one person. This SENDS to a real address — treat it as irreversible.

Targets a campaign rather than composing copy, so call list_iterable_campaigns first to confirm the campaign id. State the recipient and campaign before calling. Always requires human approval and cannot run from a scheduled task.`,
          inputSchema: z.object({
            campaign_id: z.union([z.number(), z.string()]).describe("The campaign id"),
            recipient_email: z
              .string()
              .optional()
              .describe("Recipient email. Provide this or recipient_user_id."),
            recipient_user_id: z.string().optional().describe("Recipient userId"),
            data_fields: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Values for the template's variables"),
          }),
          approval: externalSendApproval(),
          async execute({
            campaign_id,
            recipient_email,
            recipient_user_id,
            data_fields,
          }) {
            try {
              const who = recipient_email || recipient_user_id
              return {
                ...ok(
                  await it.sendEmailToUser({
                    campaignId: campaign_id,
                    recipientEmail: recipient_email,
                    recipientUserId: recipient_user_id,
                    dataFields: data_fields,
                  })
                ),
                message: `Sent campaign ${campaign_id} to ${who}`,
              }
            } catch (error) {
              return fail(error, "Failed to send email")
            }
          },
        }),
      }
    },
  },
})
