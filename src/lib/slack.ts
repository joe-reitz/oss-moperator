/**
 * Slack API Helpers
 *
 * Extracted Slack utilities shared across the events route and command system.
 */

// ─── Message Sending ─────────────────────────────────────────────────────────

export interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: Array<{
    type: string
    text?: { type: string; text: string; emoji?: boolean }
    url?: string
    style?: string
    action_id?: string
  }>
}

export async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
  blocks?: SlackBlock[]
) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured")
  }

  const body: Record<string, unknown> = { channel, text }
  if (threadTs) body.thread_ts = threadTs
  if (blocks) body.blocks = blocks

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!data.ok) {
    console.error("[Slack] Failed to send message:", data.error)
  }
  return data
}

export async function deleteMessage(channel: string, timestamp: string) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return

  await fetch("https://slack.com/api/chat.delete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, ts: timestamp }),
  })
}

// ─── File Uploads ─────────────────────────────────────────────────────────────

export async function uploadSlackFile(
  channel: string,
  content: string,
  filename: string,
  title: string,
  threadTs?: string
) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_BOT_TOKEN not configured")

  const contentBuffer = Buffer.from(content, "utf-8")

  // Step 1: Get upload URL
  const urlRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      filename,
      length: String(contentBuffer.length),
    }),
  })

  const urlData = await urlRes.json()
  if (!urlData.ok) {
    console.error("[Slack] Failed to get upload URL:", urlData.error)
    return urlData
  }

  // Step 2: Upload content
  const uploadRes = await fetch(urlData.upload_url, {
    method: "POST",
    body: contentBuffer,
  })

  if (!uploadRes.ok) {
    return { ok: false, error: "upload_failed" }
  }

  // Step 3: Complete upload
  const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [{ id: urlData.file_id, title }],
      channel_id: channel,
      thread_ts: threadTs,
    }),
  })

  return completeRes.json()
}

// ─── User Info ────────────────────────────────────────────────────────────────

export async function getSlackUserInfo(
  userId: string
): Promise<{ email?: string; name?: string } | null> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return null

  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (data.ok && data.user?.profile) {
      return {
        email: data.user.profile.email,
        name: data.user.profile.real_name || data.user.profile.display_name,
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── Thread History ───────────────────────────────────────────────────────────

export async function getThreadHistory(
  channel: string,
  threadTs: string,
  currentMessageTs?: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return []

  try {
    const res = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json()

    if (!data.ok || !data.messages) return []

    const rawHistory: Array<{ role: "user" | "assistant"; content: string }> = []
    const botUserId = process.env.SLACK_BOT_USER_ID

    for (const msg of data.messages) {
      if (currentMessageTs && msg.ts === currentMessageTs) continue

      const isBot = msg.bot_id || (botUserId && msg.user === botUserId)
      const role = isBot ? "assistant" as const : "user" as const

      let content = msg.text || ""
      content = content.replace(/<@[A-Z0-9]+>/g, "").trim()

      if (content) {
        rawHistory.push({ role, content })
      }
    }

    // Merge consecutive same-role messages (API requires alternating roles)
    const history: Array<{ role: "user" | "assistant"; content: string }> = []
    for (const msg of rawHistory) {
      const last = history[history.length - 1]
      if (last && last.role === msg.role) {
        last.content += "\n\n" + msg.content
      } else {
        history.push({ ...msg })
      }
    }

    // Ensure starts with user message
    while (history.length > 0 && history[0].role === "assistant") {
      history.shift()
    }

    return history
  } catch {
    return []
  }
}

// ─── Thinking Messages ────────────────────────────────────────────────────────

const THINKING_MESSAGES = [
  "Thinking...",
  "Working on it...",
  "Querying data...",
  "Processing your request...",
  "Looking into that...",
  "Let me check...",
]

function getRandomThinkingMessage(): string {
  return THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)]
}

export async function postThinkingMessage(
  channel: string,
  threadTs?: string
): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return null

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: getRandomThinkingMessage(),
      thread_ts: threadTs,
    }),
  })

  const data = await res.json()
  return data.ok ? data.ts : null
}

// ─── File Downloads ───────────────────────────────────────────────────────────

export async function downloadSlackFile(fileUrl: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return null

  try {
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function markdownToSlack(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/^###\s*(.+)$/gm, "*$1*")
    .replace(/^##\s*(.+)$/gm, "*$1*")
    .replace(/^#\s*(.+)$/gm, "*$1*")
}

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

export function recordsToCSV(records: Record<string, unknown>[]): string {
  if (!records || records.length === 0) return ""

  const keys = Array.from(new Set(records.flatMap((r) => Object.keys(r))))
  const header = keys.join(",")

  const rows = records.map((record) => {
    return keys
      .map((key) => {
        const value = record[key]
        if (value === null || value === undefined) return ""
        const str = typeof value === "object" ? JSON.stringify(value) : String(value)
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      .join(",")
  })

  return [header, ...rows].join("\n")
}
