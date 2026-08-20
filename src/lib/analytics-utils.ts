import type { StoredEvent } from "@agent/lib/analytics"
import { getSlackUserInfo } from "@/lib/slack-users"

const SLACK_ID_PATTERN = /^U[A-Z0-9]{8,}$/

/**
 * Resolve Slack user IDs in event userNames to display names.
 * Batches lookups so each unique ID is only resolved once.
 */
export async function resolveSlackUserNames(events: StoredEvent[]): Promise<StoredEvent[]> {
  const idsToResolve = [...new Set(
    events
      .map((e) => e.userName)
      .filter((name) => SLACK_ID_PATTERN.test(name))
  )]

  if (idsToResolve.length === 0) return events

  const nameMap = new Map<string, string>()
  const results = await Promise.allSettled(
    idsToResolve.map(async (id) => {
      const info = await getSlackUserInfo(id)
      if (info?.name) nameMap.set(id, info.name)
    })
  )

  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("[analytics-utils] Failed to resolve Slack user:", r.reason)
    }
  }

  if (nameMap.size === 0) return events

  return events.map((e) => {
    const resolved = nameMap.get(e.userName)
    if (resolved) return { ...e, userName: resolved }
    return e
  })
}
