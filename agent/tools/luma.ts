/**
 * Luma event tools.
 *
 * Creating a registration page is outward-facing and awkward to undo, so it is
 * gated on approval. That gate *is* the confirmation step: eve renders the full
 * tool input — name, time, timezone, location, visibility, approval setting,
 * co-organizers — as the approval prompt, and the turn parks until a human says
 * go.
 *
 * That is why this repo no longer has a pending-event Redis store, a
 * confirmation-card Block Kit builder, or an interactions route to receive the
 * button press. One approval policy replaced all three.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { externalSendApproval } from "../lib/approval"
import { config } from "../lib/config"
import { isConfigured } from "../lib/integrations"
import * as luma from "../lib/luma/client"

/** Luma wants an ISO-8601 duration; derive it so the model does not have to. */
function durationInterval(startAt: string, endAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000)
  )
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `PT${hours}H${rest}M` : `PT${hours}H`
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("luma")) return null

      return {
        create_luma_event: defineTool({
          description: `Create an event registration page on Luma (lu.ma).

Only use this when someone explicitly asks for a Luma or lu.ma event. "Create a campaign" means a Salesforce campaign, not this.

Compliance registration questions (Company + job title, Country, marketing opt-in) are attached automatically. Do not add them yourself.

Extract from the request: name, start and end time, location, description. Infer the IANA timezone from the city — San Francisco is America/Los_Angeles, New York America/New_York, London Europe/London, Berlin Europe/Berlin, Tokyo Asia/Tokyo, Singapore Asia/Singapore, Sydney Australia/Sydney. Pass times as local wall-clock ISO strings (2026-03-15T18:00:00) plus the timezone; do not convert to UTC yourself.

Co-organizers: scan the title and description for "with <Org>", "co-hosted with <Org>", "presented by <Org>", "<Org> is sponsoring". Put external orgs in \`partners\` — that adds a data-sharing opt-in to the registration form, which Legal needs. Leave out venues, caterers, and vague phrases${
            config.orgName ? `, and leave out ${config.orgName} itself` : ""
          }.

Registration approval defaults to on. Only set require_approval false if the user explicitly asked for open or auto-approved registration.

Salesforce link: if the user gives a Campaign ID (starts with 701), pass it as salesforce_campaign_id and the created event id gets stamped onto that campaign.

Events are private (link-only) unless visibility is set to public. This requires human approval — say what you are about to create and let the approval prompt confirm the details.`,
          inputSchema: z.object({
            name: z.string().describe("Event title"),
            start_at: z
              .string()
              .describe("Local start time as ISO 8601 without offset, e.g. 2026-03-15T18:00:00"),
            end_at: z.string().describe("Local end time in the same form"),
            timezone: z
              .string()
              .describe("IANA timezone for the times above, e.g. America/New_York"),
            description: z
              .string()
              .optional()
              .describe("Event description, markdown supported"),
            address: z.string().optional().describe("Venue street address"),
            city: z.string().optional().describe("City"),
            region: z.string().optional().describe("State or region"),
            country: z.string().optional().describe("Country"),
            meeting_url: z
              .string()
              .optional()
              .describe("Virtual event URL, for an online event"),
            cover_url: z.string().optional().describe("Cover image URL"),
            visibility: z
              .enum(["public", "private"])
              .optional()
              .describe("Defaults to private (accessible by direct link only)"),
            require_approval: z
              .boolean()
              .optional()
              .describe(
                "Whether registrations need host approval. Defaults to true."
              ),
            partners: z
              .array(z.string())
              .optional()
              .describe(
                "External co-organizers or sponsors. Adds a data-sharing opt-in to registration."
              ),
            salesforce_campaign_id: z
              .string()
              .optional()
              .describe("Salesforce Campaign ID (starts with 701) to stamp with the event id"),
          }),
          approval: externalSendApproval(),
          async execute(input) {
            try {
              const hasLocation =
                input.address || input.city || input.region || input.country

              const result = await luma.createEvent({
                name: input.name,
                start_at: input.start_at,
                end_at: input.end_at,
                timezone: input.timezone,
                duration_interval: durationInterval(input.start_at, input.end_at),
                description: input.description,
                geo_address_json: hasLocation
                  ? {
                      address: input.address || "",
                      city: input.city || "",
                      region: input.region || "",
                      country: input.country || "",
                    }
                  : null,
                meeting_url: input.meeting_url,
                cover_url: input.cover_url,
                visibility: input.visibility || "private",
                registration_questions: [],
                require_rsvp_approval: input.require_approval ?? true,
                partners: (input.partners ?? [])
                  .map((partner) => partner.trim())
                  .filter(Boolean),
              })

              // Best-effort: link the event back to its Salesforce campaign so
              // attribution works later. A failure here does not undo the event.
              let salesforceLink: string | null = null
              if (input.salesforce_campaign_id) {
                try {
                  await luma.updateSfdcCampaignWithLumaEvent(
                    input.salesforce_campaign_id,
                    result.event_id
                  )
                  salesforceLink = `Stamped campaign ${input.salesforce_campaign_id} with event ${result.event_id}`
                } catch (error) {
                  salesforceLink = `Event created, but linking campaign ${
                    input.salesforce_campaign_id
                  } failed: ${error instanceof Error ? error.message : "unknown error"}`
                }
              }

              return {
                success: true as const,
                ...result,
                visibility: input.visibility || "private",
                require_approval: input.require_approval ?? true,
                partners: input.partners ?? [],
                salesforce_link: salesforceLink,
              }
            } catch (error) {
              return {
                success: false as const,
                error:
                  error instanceof Error ? error.message : "Failed to create the event",
              }
            }
          },
        }),

        update_luma_event_visibility: defineTool({
          description:
            "Change a Luma event between public and private. Accepts a lu.ma URL, slug, or event API id. Requires approval, since making an event public exposes the page.",
          inputSchema: z.object({
            event: z
              .string()
              .describe("Event URL, slug, or api id, e.g. https://lu.ma/abc123 or evt-xxxx"),
            visibility: z.enum(["public", "private"]),
          }),
          approval: externalSendApproval(),
          async execute({ event, visibility }) {
            try {
              const eventId = await luma.resolveLumaEventApiId(event)
              if (!eventId) {
                return {
                  success: false as const,
                  error: `Could not resolve "${event}" to a Luma event.`,
                }
              }
              await luma.updateEventVisibility(eventId, visibility)
              return { success: true as const, event_id: eventId, visibility }
            } catch (error) {
              return {
                success: false as const,
                error:
                  error instanceof Error ? error.message : "Failed to update visibility",
              }
            }
          },
        }),

        add_luma_event_host: defineTool({
          description:
            "Grant someone host access to a Luma event so they can manage registrations. Requires approval.",
          inputSchema: z.object({
            event: z.string().describe("Event URL, slug, or api id"),
            email: z.string().email().describe("Email of the person to add as host"),
            name: z.string().optional().describe("Their display name"),
          }),
          approval: externalSendApproval(),
          async execute({ event, email, name }) {
            try {
              const eventId = await luma.resolveLumaEventApiId(event)
              if (!eventId) {
                return {
                  success: false as const,
                  error: `Could not resolve "${event}" to a Luma event.`,
                }
              }
              await luma.addHost(eventId, email, name)
              return { success: true as const, event_id: eventId, host: email }
            } catch (error) {
              return {
                success: false as const,
                error: error instanceof Error ? error.message : "Failed to add host",
              }
            }
          },
        }),
      }
    },
  },
})
