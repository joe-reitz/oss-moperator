/**
 * Slack Events API handler for mOperator
 * Handles @mentions and DMs with CSV export support
 * Includes approval workflow for Salesforce write operations
 */

import { waitUntil } from "@vercel/functions"
import type { Tool } from "ai"
import { generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { getAIModel } from "@/lib/ai"
import { getAllTools } from "@/lib/tools"
import { SLACK_SYSTEM_PROMPT } from "@/lib/agent-config"
import {
  sendSlackMessage,
  deleteMessage,
  uploadSlackFile,
  getSlackUserInfo,
  getThreadHistory,
  postThinkingMessage,
  downloadSlackFile,
  markdownToSlack,
  recordsToCSV,
} from "@/lib/slack"
import { fileIssueFromMessage } from "@/lib/integrations/linear"
import { isAuthorizedUser, getApproverGroupMention } from "@/lib/permissions"
import { storePendingApproval } from "@/lib/approval-store"

const CSV_EXPORT_ROW_LIMIT = 10_000

// The 5 Salesforce write tools that require approval for non-authorized users
const GATED_TOOL_NAMES = [
  "updateSalesforceRecord",
  "createSalesforceRecord",
  "deleteSalesforceRecord",
  "bulkUpdateRecords",
  "addContactsToCampaign",
] as const

// Bulk record limits
const AUTHORIZED_BULK_LIMIT = 1_500
const NON_AUTHORIZED_BULK_LIMIT = 500

/**
 * Generate a human-readable description of a Salesforce write operation
 * for the approval message posted in Slack.
 */
function describeOperation(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "updateSalesforceRecord":
      return `Update ${args.objectName} record \`${args.recordId}\``
    case "createSalesforceRecord":
      return `Create a new ${args.objectName} record`
    case "deleteSalesforceRecord":
      return `Delete ${args.objectName} record \`${args.recordId}\``
    case "bulkUpdateRecords": {
      const records = args.records as Array<unknown> | undefined
      const count = records?.length ?? 0
      return `Bulk update ${count} ${args.objectName} record${count !== 1 ? "s" : ""}`
    }
    case "addContactsToCampaign": {
      const contactIds = args.contactIds as Array<unknown> | undefined
      const count = contactIds?.length ?? 0
      return `Add ${count} contact${count !== 1 ? "s" : ""} to campaign \`${args.campaignId}\``
    }
    default:
      return `Execute ${toolName}`
  }
}

/**
 * Build the tools object for a given request, wrapping gated SF write tools
 * with authorization checks. Non-authorized users get approval-gated versions
 * that store the operation and post Approve/Deny buttons instead of executing.
 */
function getToolsForRequest(
  isAuthorized: boolean,
  channel: string,
  threadTs: string,
  userId: string
): Record<string, Tool> {
  const allTools = getAllTools()
  const wrappedTools: Record<string, Tool> = {}

  for (const [name, t] of Object.entries(allTools)) {
    if (!(GATED_TOOL_NAMES as readonly string[]).includes(name)) {
      // Non-gated tool — pass through as-is
      wrappedTools[name] = t as Tool
      continue
    }

    if (isAuthorized) {
      // Authorized user — execute immediately, but enforce bulk limits
      if (name === "bulkUpdateRecords") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            objectName: z.string(),
            records: z.array(z.object({ Id: z.string() }).passthrough()),
          }),
          execute: async (args) => {
            if (args.records.length > AUTHORIZED_BULK_LIMIT) {
              return {
                success: false,
                error: `Bulk operations are limited to ${AUTHORIZED_BULK_LIMIT} records. You submitted ${args.records.length}.`,
              }
            }
            const original = t as { execute?: (args: Record<string, unknown>) => Promise<unknown> }
            if (original.execute) {
              return original.execute(args as unknown as Record<string, unknown>)
            }
            return { success: false, error: "Tool execute function not found" }
          },
        }) as Tool
      } else {
        // Other authorized write tools — pass through directly
        wrappedTools[name] = t as Tool
      }
    } else {
      // Non-authorized user — gate with approval workflow
      if (name === "bulkUpdateRecords") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            objectName: z.string(),
            records: z.array(z.object({ Id: z.string() }).passthrough()),
          }),
          execute: async (args) => {
            if (args.records.length > NON_AUTHORIZED_BULK_LIMIT) {
              return {
                success: false,
                error: `Bulk operations are limited to ${NON_AUTHORIZED_BULK_LIMIT} records for non-authorized users. You submitted ${args.records.length}.`,
              }
            }
            return requestApproval(name, args as unknown as Record<string, unknown>, channel, threadTs, userId)
          },
        }) as Tool
      } else if (name === "updateSalesforceRecord") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            objectName: z.string(),
            recordId: z.string(),
            data: z.record(z.string(), z.unknown()),
          }),
          execute: async (args) => {
            return requestApproval(name, args as unknown as Record<string, unknown>, channel, threadTs, userId)
          },
        }) as Tool
      } else if (name === "createSalesforceRecord") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            objectName: z.string(),
            data: z.record(z.string(), z.unknown()),
          }),
          execute: async (args) => {
            return requestApproval(name, args as unknown as Record<string, unknown>, channel, threadTs, userId)
          },
        }) as Tool
      } else if (name === "deleteSalesforceRecord") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            objectName: z.string(),
            recordId: z.string(),
          }),
          execute: async (args) => {
            return requestApproval(name, args as unknown as Record<string, unknown>, channel, threadTs, userId)
          },
        }) as Tool
      } else if (name === "addContactsToCampaign") {
        wrappedTools[name] = tool({
          description: (t as { description?: string }).description || `Execute ${name}`,
          inputSchema: z.object({
            campaignId: z.string(),
            contactIds: z.array(z.string()),
            status: z.string().optional(),
          }),
          execute: async (args) => {
            return requestApproval(name, args as unknown as Record<string, unknown>, channel, threadTs, userId)
          },
        }) as Tool
      }
    }
  }

  return wrappedTools
}

/**
 * Store the operation in Redis and post an approval request in the Slack thread.
 */
async function requestApproval(
  toolName: string,
  args: Record<string, unknown>,
  channel: string,
  threadTs: string,
  userId: string
): Promise<{ success: boolean; pending_approval: boolean; message: string }> {
  const approvalId = crypto.randomUUID()
  const description = describeOperation(toolName, args)
  const userInfo = await getSlackUserInfo(userId)
  const userName = userInfo?.name || userId
  const approverMention = getApproverGroupMention()

  const stored = await storePendingApproval({
    id: approvalId,
    toolName,
    args,
    userId,
    channel,
    threadTs,
    messageTs: "",
    description,
    createdAt: Date.now(),
  })

  if (!stored) {
    return {
      success: false,
      pending_approval: false,
      message: "Redis is not configured. Approval workflow requires Redis. Please configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    }
  }

  await sendSlackMessage(
    channel,
    `${approverMention} Approval needed from *${userName}*:\n\n*${description}*\n\n_This request will expire in 30 minutes._`,
    threadTs,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${approverMention} Approval needed from *${userName}*:\n\n*${description}*\n\n_This request will expire in 30 minutes._`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve", emoji: true },
            style: "primary",
            action_id: "approve_operation",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny", emoji: true },
            style: "danger",
            action_id: "deny_operation",
          },
        ],
      },
    ]
  )

  return {
    success: true,
    pending_approval: true,
    message: `Your request to ${description.toLowerCase()} has been submitted for approval.`,
  }
}

// Check if user wants CSV export
function wantsCSV(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes("csv") || lower.includes("export") || lower.includes("download") || lower.includes("spreadsheet")
}

// Check for Linear issue shortcuts
function wantsLinearIssue(text: string): { type: "bug" | "feature"; description: string } | null {
  const patterns: Array<{ regex: RegExp; type: "bug" | "feature" }> = [
    { regex: /^bug:\s*(.+)/i, type: "bug" },
    { regex: /^feature\s*request:\s*(.+)/i, type: "feature" },
    { regex: /^feature:\s*(.+)/i, type: "feature" },
    { regex: /^todo:\s*(.+)/i, type: "feature" },
  ]

  for (const { regex, type } of patterns) {
    const match = text.match(regex)
    if (match) {
      return { type, description: match[1].trim() }
    }
  }
  return null
}

// Store query results for CSV export (per-request)
interface RequestContext {
  queryResults: Record<string, unknown>[] | null
}

interface ProcessResult {
  text: string
  records: Record<string, unknown>[] | null
}

async function processMessage(
  text: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
  authContext: { isAuthorized: boolean; channel: string; threadTs: string; userId: string }
): Promise<ProcessResult> {
  const ctx: RequestContext = { queryResults: null }
  const tools = getToolsForRequest(
    authContext.isAuthorized,
    authContext.channel,
    authContext.threadTs,
    authContext.userId
  )

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...conversationHistory,
    { role: "user", content: text },
  ]

  const { text: responseText } = await generateText({
    model: getAIModel(),
    system: SLACK_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(10),
    messages,
    onStepFinish({ toolResults }) {
      for (const result of toolResults) {
        if (result.toolName === "querySalesforce" && result.output) {
          const data = result.output as { success: boolean; records?: Record<string, unknown>[] }
          if (data.success && data.records) {
            ctx.queryResults = data.records
          }
        }
      }
    },
  })

  return {
    text: responseText || "I processed your request but couldn't generate a response.",
    records: ctx.queryResults,
  }
}

interface SlackFile {
  url_private: string
  name: string
  filetype: string
  mimetype: string
}

async function getAttachedCSV(event: { files?: SlackFile[] }): Promise<string | null> {
  if (!event.files || event.files.length === 0) return null
  const csvFile = event.files.find(
    (f) => f.filetype === "csv" || f.name.endsWith(".csv") || f.mimetype === "text/csv"
  )
  if (!csvFile) return null
  return downloadSlackFile(csvFile.url_private)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Slack URL verification
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (body.type === "event_callback") {
      const event = body.event

      // Ignore bot messages
      if (event.bot_id || event.subtype === "bot_message") {
        return new Response("ok")
      }

      if (event.type === "app_mention" || event.type === "message") {
        const text = event.text?.replace(/<@[A-Z0-9]+>/g, "").trim() || ""
        const slackUserId: string = event.user

        if (!text) {
          await sendSlackMessage(
            event.channel,
            "Hey! Ask me anything. Try: `show me active campaigns` or `export contacts as csv`",
            event.thread_ts || event.ts
          )
          return new Response("ok")
        }

        const shouldExportCSV = wantsCSV(text)
        const threadTs = event.thread_ts || event.ts

        waitUntil(
          (async () => {
            let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
            if (event.thread_ts) {
              conversationHistory = await getThreadHistory(event.channel, event.thread_ts, event.ts)
            }

            const thinkingTs = await postThinkingMessage(event.channel, threadTs)

            // Check authorization once per request
            const isAuthorized = await isAuthorizedUser(slackUserId)

            try {
              // Handle Linear issue shortcuts
              const linearMatch = wantsLinearIssue(text)
              if (linearMatch) {
                try {
                  const result = await fileIssueFromMessage(linearMatch.description, linearMatch.type)
                  if (thinkingTs) await deleteMessage(event.channel, thinkingTs)

                  if (result.success) {
                    const label = linearMatch.type === "bug" ? "Bug filed" : "Feature request filed"
                    await sendSlackMessage(event.channel, `*${label}:* <${result.url}|${result.identifier}> — ${result.title}`, threadTs)
                  } else {
                    await sendSlackMessage(event.channel, `Failed to file issue: ${result.error}`, threadTs)
                  }
                  return
                } catch {
                  // Fall through to normal processing
                }
              }

              let messageToProcess = text

              // Attach CSV data if present
              const csvData = await getAttachedCSV(event)
              if (csvData) {
                const csvPreview = csvData.length > 10000 ? csvData.substring(0, 10000) + "\n...(truncated)" : csvData
                messageToProcess = `${text}\n\nAttached CSV data:\n\`\`\`\n${csvPreview}\n\`\`\``
              }

              const result = await processMessage(messageToProcess, conversationHistory, {
                isAuthorized,
                channel: event.channel,
                threadTs,
                userId: slackUserId,
              })

              if (thinkingTs) await deleteMessage(event.channel, thinkingTs)

              const slackText = markdownToSlack(result.text)
              await sendSlackMessage(event.channel, slackText, threadTs)

              // CSV export
              if (shouldExportCSV && result.records && result.records.length > 0) {
                const totalCount = result.records.length
                const truncated = totalCount > CSV_EXPORT_ROW_LIMIT
                const exportRecords = truncated ? result.records.slice(0, CSV_EXPORT_ROW_LIMIT) : result.records
                const csv = recordsToCSV(exportRecords)
                const timestamp = new Date().toISOString().split("T")[0]
                const title = truncated
                  ? `Export (${CSV_EXPORT_ROW_LIMIT.toLocaleString()} of ${totalCount.toLocaleString()} records)`
                  : `Export (${totalCount.toLocaleString()} records)`

                await uploadSlackFile(event.channel, csv, `moperator-export-${timestamp}.csv`, title, threadTs)

                if (truncated) {
                  await sendSlackMessage(event.channel, `Your export was capped at ${CSV_EXPORT_ROW_LIMIT.toLocaleString()} rows. Try narrowing your query.`, threadTs)
                }
              }
            } catch (error) {
              if (thinkingTs) await deleteMessage(event.channel, thinkingTs)
              await sendSlackMessage(event.channel, `Sorry, I hit an error: ${error instanceof Error ? error.message : "Unknown error"}`, threadTs)
            }
          })()
        )

        return new Response("ok")
      }
    }

    return new Response("ok")
  } catch (error) {
    console.error("[Slack] Error:", error)
    return new Response("error", { status: 500 })
  }
}
