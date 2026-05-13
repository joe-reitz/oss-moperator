/**
 * Slack Interactivity Handler
 *
 * Handles button clicks from Slack interactive messages — specifically
 * the Approve/Deny buttons on Salesforce write operation approval requests.
 *
 * Slack sends a form-urlencoded POST with a `payload` field containing JSON.
 * Configure your Slack app's Interactivity Request URL to point here:
 *   https://your-domain.com/api/slack/interactions
 */

import { waitUntil } from "@vercel/functions"
import { trackEvent } from "@/lib/analytics"
import { clearPendingApproval } from "@/lib/approval-store"
import { isAuthorizedUser } from "@/lib/permissions"
import { readVerifiedSlackBody } from "@/lib/slack-signature"
import {
  getSlackUserInfo,
  sendSlackMessage,
  updateSlackMessage,
  postEphemeralMessage,
} from "@/lib/slack"
import { getAllTools } from "@/lib/tools"

interface SlackInteractionPayload {
  type: string
  user: { id: string; name: string }
  channel: { id: string }
  message: { ts: string; text: string }
  actions: Array<{
    action_id: string
    block_id: string
    value?: string
  }>
  trigger_id: string
}

export async function POST(req: Request) {
  try {
    const verified = await readVerifiedSlackBody(req)
    if ("error" in verified) {
      return new Response(verified.error, { status: verified.status })
    }
    const params = new URLSearchParams(verified.rawBody)
    const rawPayload = params.get("payload")

    if (!rawPayload) {
      return new Response("Missing payload", { status: 400 })
    }

    const payload: SlackInteractionPayload = JSON.parse(rawPayload)

    // Only handle block_actions (button clicks)
    if (payload.type !== "block_actions") {
      return new Response("ok")
    }

    const action = payload.actions?.[0]
    if (!action) return new Response("ok")

    const { action_id } = action
    const clickerUserId = payload.user.id
    const channel = payload.channel.id
    const messageTs = payload.message.ts
    const messageText = payload.message.text || ""

    // ── Luma event creation ─────────────────────────────────────────────────
    // Two buttons share the same flow:
    //   create_luma_event       → require_approval = true
    //   create_luma_event_open  → require_approval = false (open registration)
    if (action_id === "create_luma_event" || action_id === "create_luma_event_open") {
      const requireApprovalChoice = action_id === "create_luma_event"
      const confirmationId = action.value || ""
      waitUntil(handleLumaCreate(confirmationId, requireApprovalChoice, clickerUserId, channel, messageTs))
      return new Response("ok")
    }

    if (action_id === "cancel_luma_event") {
      const confirmationId = action.value || ""
      const { clearPendingLumaEvent } = await import("@/lib/integrations/luma/client")
      await clearPendingLumaEvent(confirmationId)
      await updateSlackMessage(
        channel,
        messageTs,
        `_Luma event creation cancelled by <@${clickerUserId}>_`
      )
      return new Response("ok")
    }

    if (action_id !== "approve_operation" && action_id !== "deny_operation") {
      return new Response("ok")
    }

    // Verify the clicker is authorized
    const isClickerAuthorized = await isAuthorizedUser(clickerUserId)
    if (!isClickerAuthorized) {
      await postEphemeralMessage(
        channel,
        clickerUserId,
        "You are not authorized to approve or deny operations. Only authorized users can do this."
      )
      return new Response("ok")
    }

    // Extract the approval ID from the message — we store it in the approval store
    // keyed by the combination of channel + message timestamp
    const approval = await findApprovalByMessage(messageText)

    if (!approval) {
      await updateSlackMessage(
        channel,
        messageTs,
        "_This approval request has expired or was already handled._"
      )
      return new Response("ok")
    }

    if (action_id === "approve_operation") {
      // Execute the stored operation
      await updateSlackMessage(
        channel,
        messageTs,
        `_Approved by <@${clickerUserId}>. Executing..._`
      )

      try {
        const result = await executeStoredOperation(approval.toolName, approval.args)
        await sendSlackMessage(
          channel,
          `Approved by <@${clickerUserId}>.\n\n*${approval.description}* — completed.\n\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\``,
          approval.threadTs
        )
      } catch (error) {
        await sendSlackMessage(
          channel,
          `Approved by <@${clickerUserId}>, but the operation failed:\n\`\`\`\n${error instanceof Error ? error.message : "Unknown error"}\n\`\`\``,
          approval.threadTs
        )
      }

      await clearPendingApproval(approval.id)
    } else if (action_id === "deny_operation") {
      await updateSlackMessage(
        channel,
        messageTs,
        `_Denied by <@${clickerUserId}>._\n\n~${approval.description}~`
      )

      await sendSlackMessage(
        channel,
        `Your request to ${approval.description.toLowerCase()} was denied by <@${clickerUserId}>.`,
        approval.threadTs
      )

      await clearPendingApproval(approval.id)
    }

    return new Response("ok")
  } catch (error) {
    console.error("[Slack Interactions] Error:", error)
    return new Response("error", { status: 500 })
  }
}

/**
 * Find the pending approval that matches the message text.
 * We look for the approval description in the message text to link
 * the button click back to the stored approval.
 *
 * This uses a scan approach — since approvals have a 30-min TTL
 * and volume is low, this is acceptable. For higher volume,
 * consider encoding the approval ID in the button value.
 */
async function findApprovalByMessage(messageText: string) {
  // We need to find the approval. Since the approval ID isn't in the button payload
  // in the current implementation, we'll use Redis SCAN to find it.
  // This works because approval volume is low and they expire after 30 min.
  const { getRedis } = await import("@/lib/redis")
  const redis = getRedis()
  if (!redis) return null

  // Scan for all approval keys
  let cursor = 0
  do {
    const [nextCursor, keys] = await redis.scan(cursor, {
      match: "approval:*",
      count: 100,
    })
    cursor = typeof nextCursor === "string" ? parseInt(nextCursor, 10) : nextCursor

    for (const key of keys) {
      const data = await redis.get<string>(key)
      if (!data) continue

      try {
        const approval = typeof data === "string" ? JSON.parse(data) : data
        // Check if the message text contains the approval description
        if (messageText.includes(approval.description)) {
          return approval as {
            id: string
            toolName: string
            args: Record<string, unknown>
            userId: string
            channel: string
            threadTs: string
            description: string
          }
        }
      } catch {
        continue
      }
    }
  } while (cursor !== 0)

  return null
}

/**
 * Execute a stored Salesforce tool operation after approval.
 */
async function executeStoredOperation(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tools = getAllTools()
  const toolDef = tools[toolName]

  if (!toolDef) {
    throw new Error(`Tool "${toolName}" not found`)
  }

  // The AI SDK tool has an execute function
  const t = toolDef as { execute?: (args: Record<string, unknown>) => Promise<unknown> }
  if (!t.execute) {
    throw new Error(`Tool "${toolName}" has no execute function`)
  }

  return t.execute(args)
}

/**
 * Run a Luma event creation after the user clicks one of the confirmation
 * card buttons. Lives in waitUntil so we can ack Slack immediately.
 *
 * Optional behaviors driven by env:
 *   LUMA_AUTO_HOST_EMAIL_DOMAIN — auto-add the original requester as an
 *     event host when their Slack email matches this domain. Skip if unset.
 */
async function handleLumaCreate(
  confirmationId: string,
  requireApproval: boolean,
  clickerUserId: string,
  channel: string,
  messageTs: string
): Promise<void> {
  try {
    const {
      getPendingLumaEvent,
      clearPendingLumaEvent,
      createEvent,
      addHost,
      updateSfdcCampaignWithLumaEvent,
    } = await import("@/lib/integrations/luma/client")

    const pending = await getPendingLumaEvent(confirmationId)
    if (!pending) {
      await postEphemeralMessage(
        channel,
        clickerUserId,
        "This event creation has expired or was already handled. Ask mOperator to create it again."
      )
      return
    }

    const result = await createEvent({
      name: pending.name,
      start_at: pending.start_at,
      end_at: pending.end_at,
      timezone: pending.timezone,
      duration_interval: pending.duration_interval,
      description: pending.description,
      geo_address_json: pending.geo_address_json,
      meeting_url: pending.meeting_url,
      cover_url: pending.cover_url,
      visibility: pending.visibility,
      registration_questions: [],
      require_rsvp_approval: requireApproval,
      partners: pending.partners,
    })

    // Optional: auto-grant host access to the original requester if their
    // email matches LUMA_AUTO_HOST_EMAIL_DOMAIN.
    const requesterId = pending.requesterId || clickerUserId
    const autoHostDomain = process.env.LUMA_AUTO_HOST_EMAIL_DOMAIN
    let hostGrantedEmail: string | null = null
    if (autoHostDomain) {
      try {
        const userInfo = await getSlackUserInfo(requesterId)
        if (userInfo?.email?.endsWith(autoHostDomain)) {
          await addHost(result.event_id, userInfo.email, userInfo.name)
          hostGrantedEmail = userInfo.email
        }
      } catch (hostError) {
        console.error("[Luma] Failed to auto-grant host access:", hostError)
      }
    }

    trackEvent({
      type: "luma_event_created",
      userId: clickerUserId,
      userName: clickerUserId,
      channelId: pending.channelId,
      threadTs: pending.threadTs,
      success: true,
      metadata: {
        eventName: pending.name,
        eventId: result.event_id,
        url: result.url,
      },
    })

    let sfdcLine = ""
    if (pending.sfdcCampaignId) {
      try {
        const { field } = await updateSfdcCampaignWithLumaEvent(
          pending.sfdcCampaignId,
          result.event_id
        )
        sfdcLine = `\n:white_check_mark: Linked to SFDC Campaign \`${pending.sfdcCampaignId}\` (set \`${field}\` = \`${result.event_id}\`).`
      } catch (sfdcErr) {
        const sfdcMsg = sfdcErr instanceof Error ? sfdcErr.message : "Unknown error"
        sfdcLine = `\n:warning: Couldn't update SFDC Campaign \`${pending.sfdcCampaignId}\` automatically (${sfdcMsg}). Set the Luma event ID field to \`${result.event_id}\` manually.`
      }
    }

    const hostMsg = hostGrantedEmail
      ? `\n<@${requesterId}> has been granted event manager access.`
      : ""
    const summaryText = `*Luma event created by <@${clickerUserId}>* — <${result.manage_url}|${pending.name}>\n\nThe event is *${pending.visibility}* — ${pending.visibility === "private" ? "only people with the link can see it" : "publicly listed on the calendar"}.${hostMsg}\n\nPublic link: ${result.url}${sfdcLine}`

    await updateSlackMessage(channel, messageTs, summaryText, [
      { type: "section", text: { type: "mrkdwn", text: summaryText } },
    ])

    await clearPendingLumaEvent(confirmationId)
  } catch (error) {
    console.error("[Interactions] Luma event creation error:", error)
    const errMsg = error instanceof Error ? error.message : "Unknown error"
    await sendSlackMessage(channel, `Failed to create Luma event: ${errMsg}`)
  }
}
