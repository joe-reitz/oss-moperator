/**
 * Slack Events API handler for mOperator
 * Handles @mentions and DMs with CSV export support
 */

import { waitUntil } from "@vercel/functions"
import { generateText, stepCountIs } from "ai"
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

const CSV_EXPORT_ROW_LIMIT = 10_000

// Admin users who can delete records (Slack user IDs)
function getAdminUserIds(): string[] {
  const ids = process.env.ADMIN_SLACK_USER_IDS || ""
  return ids.split(",").map((s) => s.trim()).filter(Boolean)
}

async function canUserDelete(userId: string): Promise<boolean> {
  return getAdminUserIds().includes(userId)
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
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<ProcessResult> {
  const ctx: RequestContext = { queryResults: null }
  const tools = getAllTools()

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

              const result = await processMessage(messageToProcess, conversationHistory)

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
