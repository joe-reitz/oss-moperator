/**
 * Slack Block Kit blocks for the Luma event confirmation card.
 *
 * The createLumaEvent tool returns pending event details (without creating
 * the event). The Slack route detects that and posts these blocks with two
 * create buttons (require_approval = true / false) plus a cancel button.
 * The /api/slack/interactions handler fires `createEvent` when a button is
 * clicked.
 */

import type { SlackBlock } from "@/lib/slack"

export interface PendingLumaEventConfirmation {
  confirmationId: string
  name: string
  startAt: string
  endAt: string
  timezone: string
  description: string
  address: string
  city: string
  meetingUrl: string
  coverUrl: string
  visibility: string
  requireApproval: boolean
  partners?: string[]
  sfdcCampaignId?: string
}

export function buildLumaConfirmationBlocks(
  text: string,
  event: PendingLumaEventConfirmation
): SlackBlock[] {
  const descPreview = event.description
    ? event.description.length > 500
      ? event.description.substring(0, 497) + "..."
      : event.description
    : "_No description provided_"

  const startDate = new Date(event.startAt)
  const endDate = new Date(event.endAt)
  const dateStr = startDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: event.timezone })
  const startTime = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone })
  const endTime = endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone })

  let detailLines = `*Date:* ${dateStr}\n*Time:* ${startTime} – ${endTime} (${event.timezone})`
  if (event.address || event.city) {
    const location = [event.address, event.city].filter(Boolean).join(", ")
    detailLines += `\n*Location:* ${location}`
  }
  if (event.meetingUrl) {
    detailLines += `\n*Meeting URL:* ${event.meetingUrl}`
  }
  detailLines += `\n*Visibility:* ${event.visibility}`
  if (event.partners && event.partners.length > 0) {
    detailLines += `\n*Partners / Sponsors:* ${event.partners.join(", ")}`
    detailLines += `\n_A data-sharing opt-in checkbox will be added to the registration form._`
  }
  if (event.sfdcCampaignId) {
    detailLines += `\n*SFDC Campaign:* \`${event.sfdcCampaignId}\` _(will auto-update with the Luma event ID after create)_`
  }

  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "section", text: { type: "mrkdwn", text: detailLines } },
    { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${descPreview}` } },
  ]

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "_*Require approval* gates registrants before they get the event details. Choose *open registration* to skip approval._",
    },
  })

  type ButtonElement = {
    type: string
    text?: { type: string; text: string; emoji?: boolean }
    style?: string
    action_id?: string
    value?: string
  }

  const requireApprovalBtn: ButtonElement = {
    type: "button",
    text: { type: "plain_text", text: "Create — require approval", emoji: true },
    action_id: "create_luma_event",
    value: event.confirmationId,
    ...(event.requireApproval ? { style: "primary" } : {}),
  }
  const openRegBtn: ButtonElement = {
    type: "button",
    text: { type: "plain_text", text: "Create — open registration", emoji: true },
    action_id: "create_luma_event_open",
    value: event.confirmationId,
    ...(event.requireApproval ? {} : { style: "primary" }),
  }
  const cancelBtn: ButtonElement = {
    type: "button",
    text: { type: "plain_text", text: "Cancel", emoji: true },
    action_id: "cancel_luma_event",
    value: event.confirmationId,
  }

  blocks.push({
    type: "actions",
    elements: [requireApprovalBtn, openRegBtn, cancelBtn],
  })

  return blocks
}
