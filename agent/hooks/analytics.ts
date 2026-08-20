/**
 * Usage analytics.
 *
 * Feeds the /analytics dashboard: who uses the agent, how often, and which
 * tools. Previously these `trackEvent` calls were sprinkled through the Slack
 * route by hand, which meant any new entry point silently stopped being
 * measured. As a hook it observes the runtime's own lifecycle, so every channel
 * — Slack, the browser chat, schedules, evals — is counted the same way with no
 * per-call-site bookkeeping.
 *
 * This is deliberately *not* a replacement for tracing. Vercel Agent Runs and
 * OpenTelemetry (see `agent/instrumentation.ts` if you add one) tell you what
 * happened inside a turn. This answers a different, product-level question:
 * which people and which tools does this agent actually earn its keep on.
 *
 * Fire-and-forget throughout. Analytics must never fail a turn, so every write
 * is best-effort and every error is swallowed after logging.
 */

import { defineHook } from "eve/hooks"

import { trackEvent } from "../lib/analytics"
import { createLogger } from "../lib/logger"

const log = createLogger("analytics-hook")

interface Caller {
  email: string
  userId: string
  channelId: string
}

function caller(ctx: {
  session: { auth: { current?: { principalId?: string; attributes?: unknown } | null } }
}): Caller {
  const auth = ctx.session.auth.current
  const attributes = (auth?.attributes ?? {}) as {
    email?: string
    slackUserId?: string
    channelId?: string
  }
  return {
    email: attributes.email ?? "",
    userId: attributes.slackUserId ?? auth?.principalId ?? "unknown",
    channelId: attributes.channelId ?? "",
  }
}

export default defineHook({
  events: {
    /**
     * One event per completed tool call. `action.result` carries the tool name
     * and whether it succeeded, which is all the dashboard needs — the tool's
     * arguments and output stay out of the analytics store on purpose, since
     * they routinely contain customer data.
     */
    "action.result"(event, ctx) {
      const result = event.data.result
      if (result.kind !== "tool-result") return

      const who = caller(ctx)
      trackEvent({
        type: "tool_call",
        userId: who.userId,
        userName: who.email || who.userId,
        channelId: who.channelId,
        threadTs: ctx.session.id,
        success: event.data.status === "completed",
        metadata: { tool: result.toolName },
      })
    },

    /**
     * One event per completed turn, so "messages per week" and "active users"
     * are countable without inferring them from tool calls.
     */
    "turn.completed"(_event, ctx) {
      const who = caller(ctx)
      trackEvent({
        type: "turn",
        userId: who.userId,
        userName: who.email || who.userId,
        channelId: who.channelId,
        threadTs: ctx.session.id,
        success: true,
        metadata: {},
      })
    },

    /**
     * Failures are the most useful signal in the whole store — they tell you
     * which integrations are misconfigured in practice.
     */
    "turn.failed"(event, ctx) {
      const who = caller(ctx)
      const error = (event.data as { error?: { message?: string } } | undefined)?.error
      trackEvent({
        type: "turn",
        userId: who.userId,
        userName: who.email || who.userId,
        channelId: who.channelId,
        threadTs: ctx.session.id,
        success: false,
        metadata: { error: error?.message?.slice(0, 200) ?? "unknown" },
      })
      log.warn("Turn failed", { session: ctx.session.id, error: error?.message })
    },
  },
})
