/**
 * Slack display-name lookup for the analytics dashboard.
 *
 * All that survives of the old 366-line `src/lib/slack.ts`. Message posting,
 * file uploads, thread history, Block Kit, ephemeral messages, and
 * markdown-to-mrkdwn conversion are the Slack channel's job now
 * (`agent/channels/slack.ts`), so the only thing left is turning a stored
 * `U0123ABC` into a human name for the /analytics tables.
 *
 * Uses a plain fetch rather than eve's Slack handle: this runs in a Next.js
 * route with no inbound Slack request to derive a handle from. Deployments that
 * manage the bot token through Vercel Connect have no SLACK_BOT_TOKEN in the
 * environment, so the lookup no-ops and the dashboard shows raw IDs.
 */

interface SlackUserInfo {
  id: string
  name: string
  email?: string
}

const cache = new Map<string, SlackUserInfo | null>()

export async function getSlackUserInfo(
  userId: string
): Promise<SlackUserInfo | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return null

  try {
    const response = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    const data = (await response.json()) as {
      ok?: boolean
      user?: {
        id?: string
        real_name?: string
        name?: string
        profile?: { email?: string; real_name?: string }
      }
    }

    if (!data.ok || !data.user) {
      cache.set(userId, null)
      return null
    }

    const info: SlackUserInfo = {
      id: data.user.id ?? userId,
      name:
        data.user.profile?.real_name ||
        data.user.real_name ||
        data.user.name ||
        userId,
      email: data.user.profile?.email,
    }
    cache.set(userId, info)
    return info
  } catch {
    cache.set(userId, null)
    return null
  }
}
