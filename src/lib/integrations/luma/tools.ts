/**
 * Luma Event AI SDK Tools (single-calendar build)
 */

import { tool } from "ai"
import { z } from "zod"
import { storePendingLumaEvent } from "./client"

export const createLumaEvent = tool({
  description: `Create an event on Luma (lu.ma) with compliance registration questions automatically included.

IMPORTANT: ONLY use this tool when the user explicitly asks to create a Luma or lu.ma event. If they ask to "create a campaign", use the Salesforce campaign tools instead — "campaign" means Salesforce campaign.

Every event gets compliance fields baked in (Company + Job Title, Country, Marketing Opt-In). You do NOT need to specify these.

Extract details from the user's request: name, date/time, location, description. Infer the IANA timezone from the city. Common examples:
- San Francisco → America/Los_Angeles
- New York → America/New_York
- London → Europe/London
- Tokyo → Asia/Tokyo
- Sydney → Australia/Sydney
- Singapore → Asia/Singapore

REGISTRATION APPROVAL — Do NOT ask the user. The confirmation card shows two create buttons ("Create with approval required" and "Create with open registration"); the user picks at confirmation time. Just call the tool with the agent's best guess via requireApproval:
- Default to true ("require approval") — safer default.
- Pass false ONLY when the user explicitly opted out: "no approval needed", "open registration", "auto-approve".

PARTNERS / SPONSORS — Populates the partners array. When non-empty, a Legal-friendly data-sharing opt-in checkbox is added to the registration form. SCAN THE EVENT TITLE AND DESCRIPTION for patterns like "with <Org>", "<Org> and us", "<Org> + us", "co-hosted with <Org>", "presented by <Org>", "<Org> is a sponsor". Strip your own org's name from the list — only include external co-organizers. Don't include venues, caterers, or generic phrases like "our partners".

SFDC CAMPAIGN LINK — If the user provides a Salesforce Campaign ID (15- or 18-char ID starting with "701"), populate sfdcCampaignId. After the Luma event is created, mOperator will update that campaign's Luma event field. Leave empty if not provided — they can link it later.

The event is NOT created immediately — a confirmation card is shown first so the user can review all details. Events are created as PRIVATE (only accessible via direct link) unless visibility=public is specified.`,
  inputSchema: z.object({
    name: z.string().describe("Event title"),
    startAt: z.string().describe("ISO 8601 start time (e.g., 2026-03-15T18:00:00)"),
    endAt: z.string().describe("ISO 8601 end time"),
    timezone: z.string().describe("IANA timezone (e.g., America/New_York)"),
    description: z.string().optional().describe("Event description (markdown supported)"),
    address: z.string().optional().describe("Venue street address"),
    city: z.string().optional().describe("City name"),
    region: z.string().optional().describe("State/region"),
    country: z.string().optional().describe("Country name"),
    meetingUrl: z.string().optional().describe("Virtual event URL (Zoom, Google Meet, etc.)"),
    coverUrl: z.string().optional().describe("Cover image URL"),
    visibility: z.enum(["public", "private"]).optional().describe("Event visibility (default: private)"),
    requireApproval: z.boolean().optional().describe("Hint for which create button is primary. Defaults to TRUE. Set false ONLY if user explicitly opts out."),
    partners: z.array(z.string()).optional().describe("Names of external orgs co-organizing or sponsoring. Triggers a data-sharing opt-in checkbox in registration. Strip your own org from the list."),
    sfdcCampaignId: z.string().optional().describe("Salesforce Campaign ID (starts with '701'). If provided, mOperator will stamp the Campaign with the Luma event ID after creation."),
    _requesterId: z.string().optional().describe("Internal: Slack user ID"),
    _channelId: z.string().optional().describe("Internal: Slack channel ID"),
    _threadTs: z.string().optional().describe("Internal: Slack thread timestamp"),
  }),
  execute: async ({ name, startAt, endAt, timezone, description, address, city, region, country, meetingUrl, coverUrl, visibility, requireApproval, partners, sfdcCampaignId, _requesterId, _channelId, _threadTs }) => {
    try {
      const startDate = new Date(startAt)
      const endDate = new Date(endAt)
      const diffMs = endDate.getTime() - startDate.getTime()
      const diffMinutes = Math.round(diffMs / 60000)
      const hours = Math.floor(diffMinutes / 60)
      const minutes = diffMinutes % 60
      const durationInterval = minutes > 0 ? `PT${hours}H${minutes}M` : `PT${hours}H`

      const hasLocation = address || city || region || country
      const geoAddressJson = hasLocation
        ? { address: address || "", city: city || "", region: region || "", country: country || "" }
        : null

      const requireApprovalResolved = requireApproval ?? true
      const partnersResolved = (partners ?? []).map((p) => p.trim()).filter(Boolean)
      const sfdcCampaignIdResolved = sfdcCampaignId?.trim() || undefined

      const confirmationId = await storePendingLumaEvent({
        name,
        start_at: startAt,
        end_at: endAt,
        timezone,
        duration_interval: durationInterval,
        description,
        geo_address_json: geoAddressJson,
        meeting_url: meetingUrl,
        cover_url: coverUrl,
        visibility: visibility || "private",
        require_rsvp_approval: requireApprovalResolved,
        partners: partnersResolved.length > 0 ? partnersResolved : undefined,
        sfdcCampaignId: sfdcCampaignIdResolved,
        requesterId: _requesterId || "",
        channelId: _channelId || "",
        threadTs: _threadTs || "",
      })

      return {
        pending_confirmation: true,
        confirmationId,
        name,
        startAt,
        endAt,
        timezone,
        description: description || "",
        address: address || "",
        city: city || "",
        meetingUrl: meetingUrl || "",
        coverUrl: coverUrl || "",
        visibility: visibility || "private",
        requireApproval: requireApprovalResolved,
        partners: partnersResolved,
        sfdcCampaignId: sfdcCampaignIdResolved,
      }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to prepare Luma event",
      }
    }
  },
})
