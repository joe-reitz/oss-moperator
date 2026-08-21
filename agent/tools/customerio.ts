/**
 * Customer.io tools.
 *
 * Two of these can put email in front of real people —
 * `send_customerio_transactional_email` and `trigger_customerio_broadcast` — so
 * both carry `externalSendApproval()`: always a human, never a scheduled task.
 * A broadcast is the wider blast radius of the two: it reaches a whole segment
 * from a single call.
 *
 * Segment membership writes go through the Track API, which is a separate
 * credential. Those tools surface a message naming the missing variables rather
 * than a bare 401.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { bulkApproval, externalSendApproval, writeApproval } from "../lib/approval"
import { isConfigured } from "../lib/integrations"
import * as cio from "../lib/customerio/client"

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
      if (!isConfigured("customerio")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        get_customerio_person: defineTool({
          description:
            "Look up one Customer.io person by email address, with their attributes.",
          inputSchema: z.object({
            email: z.string().describe("The person's email address"),
          }),
          async execute({ email }) {
            try {
              return ok(await cio.getPersonByEmail(email))
            } catch (error) {
              return fail(error, "Person lookup failed")
            }
          },
        }),

        search_customerio_people: defineTool({
          description:
            "Search Customer.io people with a filter. The filter is Customer.io's own filter object — e.g. {\"and\":[{\"attribute\":{\"field\":\"plan\",\"operator\":\"eq\",\"value\":\"pro\"}}]}. Prefer get_customerio_person when you have an email.",
          inputSchema: z.object({
            filter: z
              .record(z.string(), z.unknown())
              .describe("Customer.io filter object"),
            limit: z.number().int().min(1).max(1000).optional().default(50),
          }),
          async execute({ filter, limit }) {
            try {
              return ok(await cio.searchPeople(filter, limit))
            } catch (error) {
              return fail(error, "People search failed")
            }
          },
        }),

        list_customerio_segments: defineTool({
          description:
            "List Customer.io segments — id, name, and type. Check the type before trying to change membership: only manual segments accept members, data-driven ones compute their own.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await cio.listSegments())
            } catch (error) {
              return fail(error, "Failed to list segments")
            }
          },
        }),

        get_customerio_segment_membership: defineTool({
          description:
            "List the people in a Customer.io segment. Use a small limit first — segments can be very large.",
          inputSchema: z.object({
            segment_id: z.string().describe("The segment id"),
            limit: z.number().int().min(1).max(1000).optional().default(100),
          }),
          async execute({ segment_id, limit }) {
            try {
              return ok(await cio.getSegmentMembership(segment_id, limit))
            } catch (error) {
              return fail(error, "Failed to read segment membership")
            }
          },
        }),

        list_customerio_campaigns: defineTool({
          description: "List Customer.io campaigns with their state.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await cio.listCampaigns())
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        get_customerio_campaign_metrics: defineTool({
          description:
            "Get delivery metrics for a Customer.io campaign — sent, delivered, opened, clicked, bounced, unsubscribed — over a number of periods.",
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign id"),
            period: z
              .enum(["hours", "days", "weeks", "months"])
              .optional()
              .default("days"),
            steps: z
              .number()
              .int()
              .min(1)
              .max(390)
              .optional()
              .default(30)
              .describe("How many periods back"),
          }),
          async execute({ campaign_id, period, steps }) {
            try {
              return ok(await cio.getCampaignMetrics(campaign_id, period, steps))
            } catch (error) {
              return fail(error, "Failed to read campaign metrics")
            }
          },
        }),

        list_customerio_broadcasts: defineTool({
          description:
            "List Customer.io broadcasts. Call this before triggering one, to confirm the id and that it is API-triggerable.",
          inputSchema: z.object({}),
          async execute() {
            try {
              return ok(await cio.listBroadcasts())
            } catch (error) {
              return fail(error, "Failed to list broadcasts")
            }
          },
        }),

        // ── Write (Track API) ───────────────────────────────────────────────

        identify_customerio_person: defineTool({
          description: `Create or update a Customer.io person. This is an upsert: an unknown identifier creates a new person rather than erroring, so check the identifier before writing.

Requires the Track API credentials, which are separate from the App API key.`,
          inputSchema: z.object({
            identifier: z
              .string()
              .describe(
                "The person's id or email, matching how the workspace identifies people"
              ),
            attributes: z
              .record(z.string(), z.unknown())
              .describe("Attributes to set, e.g. { email, first_name, plan }"),
          }),
          approval: writeApproval(),
          async execute({ identifier, attributes }) {
            try {
              return ok(await cio.identifyPerson(identifier, attributes))
            } catch (error) {
              return fail(error, "Failed to write person")
            }
          },
        }),

        track_customerio_event: defineTool({
          description:
            "Record a Customer.io event for a person. Events can start campaigns, so this may cause sending downstream even though it is not itself a send. Requires the Track API credentials.",
          inputSchema: z.object({
            identifier: z.string().describe("The person's id or email"),
            name: z.string().describe("Event name"),
            data: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Event properties"),
          }),
          approval: writeApproval(),
          async execute({ identifier, name, data }) {
            try {
              return ok(await cio.trackEvent(identifier, name, data))
            } catch (error) {
              return fail(error, "Failed to track event")
            }
          },
        }),

        add_to_customerio_segment: defineTool({
          description: `Add people to a MANUAL Customer.io segment by id.

Only manual segments accept this — a data-driven segment computes its own membership and will reject the call. Call list_customerio_segments first to check the type. Requires the Track API credentials.`,
          inputSchema: z.object({
            segment_id: z.string().describe("The manual segment id"),
            customer_ids: z
              .array(z.string())
              .min(1)
              .describe("Person identifiers to add"),
          }),
          approval: bulkApproval(countOf("customer_ids")),
          async execute({ segment_id, customer_ids }) {
            try {
              return {
                ...ok(await cio.addToSegment(segment_id, customer_ids)),
                message: `Added ${customer_ids.length} people to segment ${segment_id}`,
              }
            } catch (error) {
              return fail(error, "Failed to add to segment")
            }
          },
        }),

        remove_from_customerio_segment: defineTool({
          description:
            "Remove people from a manual Customer.io segment. Requires the Track API credentials.",
          inputSchema: z.object({
            segment_id: z.string().describe("The manual segment id"),
            customer_ids: z
              .array(z.string())
              .min(1)
              .describe("Person identifiers to remove"),
          }),
          approval: bulkApproval(countOf("customer_ids")),
          async execute({ segment_id, customer_ids }) {
            try {
              return {
                ...ok(await cio.removeFromSegment(segment_id, customer_ids)),
                message: `Removed ${customer_ids.length} people from segment ${segment_id}`,
              }
            } catch (error) {
              return fail(error, "Failed to remove from segment")
            }
          },
        }),

        // ── Send ────────────────────────────────────────────────────────────

        send_customerio_transactional_email: defineTool({
          description: `Send one transactional email through Customer.io. This SENDS to a real address — treat it as irreversible.

Targets an existing transactional message, so it does not compose copy; message_data fills that template's variables. State the recipient and which message before calling. Always requires human approval and cannot run from a scheduled task.`,
          inputSchema: z.object({
            transactional_message_id: z
              .string()
              .describe("The transactional message id configured in Customer.io"),
            to: z.string().describe("Recipient email address"),
            identifiers: z
              .record(z.string(), z.string())
              .describe(
                'How Customer.io should identify the recipient, e.g. { "email": "jane@acme.com" } or { "id": "123" }'
              ),
            message_data: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Values for the template's liquid variables"),
          }),
          approval: externalSendApproval(),
          async execute({ transactional_message_id, to, identifiers, message_data }) {
            try {
              return {
                ...ok(
                  await cio.sendTransactionalEmail({
                    transactionalMessageId: transactional_message_id,
                    to,
                    identifiers,
                    messageData: message_data,
                  })
                ),
                message: `Sent transactional message ${transactional_message_id} to ${to}`,
              }
            } catch (error) {
              return fail(error, "Failed to send transactional email")
            }
          },
        }),

        trigger_customerio_broadcast: defineTool({
          description: `Fire a Customer.io API-triggered broadcast. This SENDS to an entire audience from one call — the widest blast radius of any tool here.

Before calling: name the broadcast, say who it will reach (which segment, or the explicit recipient list), and how many people that is. Always requires human approval and cannot run from a scheduled task. Customer.io additionally rate-limits this to one call every 10 seconds.`,
          inputSchema: z.object({
            broadcast_id: z.string().describe("The broadcast id"),
            segment_id: z
              .string()
              .optional()
              .describe("Send to this segment. Omit if passing explicit emails."),
            emails: z
              .array(z.string())
              .optional()
              .describe("Send only to these addresses instead of a whole segment"),
            data: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Liquid data made available to the broadcast's messages"),
          }),
          approval: externalSendApproval(),
          async execute({ broadcast_id, segment_id, emails, data }) {
            try {
              const audience = segment_id
                ? `segment ${segment_id}`
                : `${emails?.length ?? 0} explicit recipients`
              return {
                ...ok(
                  await cio.triggerBroadcast(broadcast_id, {
                    segmentId: segment_id,
                    emails,
                    data,
                  })
                ),
                message: `Triggered broadcast ${broadcast_id} to ${audience}`,
              }
            } catch (error) {
              return fail(error, "Failed to trigger broadcast")
            }
          },
        }),
      }
    },
  },
})
