/**
 * Slack channel.
 *
 * This file replaces the Slack transport layer this repo used to hand-roll:
 * the events route, HMAC signature verification, the "Thinking…" placeholder
 * and its deletion, thread-history fetching, markdown-to-mrkdwn conversion,
 * Block Kit approval cards, the interactions route that received button
 * presses, and the CSV upload path. eve owns all of it.
 *
 * What is left is the part that is actually specific to mOperator:
 *
 *   1. Who is allowed to talk to the agent, and who they are (`onAppMention`,
 *      `onDirectMessage`, `onMessage`)
 *   2. Who is allowed to answer an approval (`onInputResponse`)
 *   3. Attaching exported files to the reply (`events["action.result"]`)
 */

import { connectSlackCredentials } from "@vercel/connect/eve"
import {
  defaultSlackAuth,
  slackChannel,
  type SlackChannelCredentials,
  type SlackContext,
  type SlackMessage,
} from "eve/channels/slack"

import { config, isSpendApprover, isWriteApprover } from "../lib/config"
import { authAttributes } from "../lib/identity"
import { buildHomeView } from "../lib/slack-home"
import {
  gateReply,
  MUTE_REACTION,
  type ThreadMessage,
} from "../lib/slack-reply-gate"

/**
 * Optional channel allowlist. Unset means "anywhere the app is installed",
 * which is the right default for a workspace-internal bot. Set it when the app
 * is in a Slack Connect channel with people outside your org, because a valid
 * Slack signature proves Slack sent the event — not that you trust the sender.
 */
const ALLOWED_CHANNELS = new Set(
  (process.env.MOPERATOR_ALLOWED_SLACK_CHANNELS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
)

function channelAllowed(channelId: string): boolean {
  return ALLOWED_CHANNELS.size === 0 || ALLOWED_CHANNELS.has(channelId)
}

/**
 * Read the thread so the reply gate can see who spoke last.
 *
 * One `conversations.replies` call answers both questions the gate asks: what
 * the previous message was, and whether the thread root carries the mute
 * reaction. `limit` is small because only the tail matters, and `oldest` is
 * omitted deliberately — Slack returns the root first regardless, which is
 * where the reaction lives.
 *
 * A failure here returns an empty history, and an empty history means the gate
 * cannot establish a mid-exchange, so the agent stays quiet. Failing closed is
 * right: the cost of silence is someone re-@mentioning, and the cost of the
 * other direction is what this whole module exists to stop.
 */
/**
 * The bot's own Slack user id, per workspace.
 *
 * Needed because "was the previous message mine?" cannot be answered by
 * `bot_id` alone — that matches every app in the channel, and being asked a
 * question by a *different* bot must not make this agent answer. Slack has no
 * inbound field for it, so `auth.test` is the lookup; the result is stable for
 * the life of the install, so it is cached per team and never re-fetched.
 *
 * On failure the gate falls back to `bot_id`, which is worse but not wrong for
 * a workspace with only this app in it.
 */
const botUserIds = new Map<string, string | undefined>()

async function resolveBotUserId(ctx: SlackContext): Promise<string | undefined> {
  const key = ctx.slack.teamId ?? "default"
  const cached = botUserIds.get(key)
  if (cached !== undefined || botUserIds.has(key)) return cached

  let userId: string | undefined
  try {
    const response = await ctx.slack.request("auth.test", {})
    if (response.ok) userId = (response as { user_id?: string }).user_id
  } catch {
    // Leave undefined; the gate degrades to `bot_id`.
  }
  botUserIds.set(key, userId)
  return userId
}

/**
 * Add or remove the mute reaction on the thread root.
 *
 * The flag lives on the Slack message rather than in a store on purpose. Redis
 * is optional in this project and `getRedis()` returns null when it is
 * unconfigured, so a Redis-backed mute would have silently done nothing —
 * the same broken promise as the agent saying "I'll stop auto-responding" and
 * then not stopping. A reaction is durable, survives redeploys, needs no
 * infrastructure, and is visible to everyone in the thread.
 *
 * `reactions.add` needs the `reactions:write` scope. If it is missing this says
 * so rather than reporting success, because a mute that quietly fails is the
 * bug being fixed.
 */
async function setThreadMuted(
  ctx: SlackContext,
  message: SlackMessage,
  muted: boolean
): Promise<void> {
  const operation = muted ? "reactions.add" : "reactions.remove"
  let error: string | undefined

  try {
    const response = await ctx.slack.request(operation, {
      channel: message.channelId,
      timestamp: message.threadTs,
      name: MUTE_REACTION,
    })
    if (!response.ok) error = String((response as { error?: string }).error ?? "unknown")
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "unknown"
  }

  // Already in the requested state is success as far as the caller is concerned.
  if (error === "already_reacted" || error === "no_reaction") error = undefined

  if (!error) {
    await ctx.thread.post(
      muted
        ? `Muted this thread — I will not reply unless you @mention me. \`/unquiet\` to undo, or remove the :${MUTE_REACTION}: reaction from the first message.`
        : "Unmuted. I will pick up follow-ups in this thread again."
    )
    return
  }

  await ctx.thread.post(
    error === "missing_scope"
      ? `I could not ${muted ? "set" : "clear"} the mute: my Slack app is missing the \`reactions:write\` scope. Add it in **OAuth & Permissions** and reinstall, or ${muted ? "add" : "remove"} the :${MUTE_REACTION}: reaction on the first message of this thread yourself — I read that either way.`
      : `I could not ${muted ? "set" : "clear"} the mute (Slack said \`${error}\`). You can ${muted ? "add" : "remove"} the :${MUTE_REACTION}: reaction on the first message of this thread instead — I read that either way.`
  )
}

async function readThreadTail(
  ctx: SlackContext,
  message: SlackMessage
): Promise<ThreadMessage[]> {
  try {
    const response = await ctx.slack.request("conversations.replies", {
      channel: message.channelId,
      ts: message.threadTs,
      limit: 30,
      include_all_metadata: false,
    })
    if (!response.ok) return []
    const messages = (response as { messages?: ThreadMessage[] }).messages
    return Array.isArray(messages) ? messages : []
  } catch {
    return []
  }
}

/**
 * Credentials.
 *
 * Vercel Connect is the recommended path: it rotates the bot token, verifies
 * inbound requests, and supports more than one workspace install without a
 * Slack secret living in this project's environment. Set
 * MOPERATOR_SLACK_CONNECTOR to the connector UID (e.g. "slack/moperator") that
 * `eve add channel/slack` creates.
 *
 * Without it the channel falls back to SLACK_BOT_TOKEN and
 * SLACK_SIGNING_SECRET from the environment, which is what a self-hosted or
 * non-Vercel deployment wants.
 */
const credentials: SlackChannelCredentials | undefined =
  process.env.MOPERATOR_SLACK_CONNECTOR
    ? connectSlackCredentials(process.env.MOPERATOR_SLACK_CONNECTOR)
    : undefined

/**
 * Resolve a Slack user's email and stamp it onto the session auth.
 *
 * Authorization in this agent is by email, because that is what a marketing ops
 * team already manages — `AUTHORIZED_USER_EMAILS` is the same list that gates
 * the admin pages. Resolving it once here, at the boundary, means the approval
 * policies in `agent/lib/approval.ts` stay pure: they read
 * `session.auth.current.attributes.email` and never make a network call.
 *
 * A failed lookup is not fatal. The session proceeds with no email, which means
 * the caller is treated as a non-approver — writes park for approval rather than
 * silently going through.
 */
async function authWithEmail(ctx: SlackContext, message: SlackMessage) {
  const base = defaultSlackAuth(message, ctx)
  if (!base) return null

  const userId = message.author?.userId
  if (!userId) return base

  let email: string | undefined
  try {
    const response = await ctx.slack.request("users.info", { user: userId })
    if (response.ok) {
      const user = response.user as
        | { profile?: { email?: string }; real_name?: string; name?: string }
        | undefined
      email = user?.profile?.email
    }
  } catch {
    // Missing users:read.email scope, or a transient Slack failure. Fall
    // through to the no-email path.
  }

  return {
    ...base,
    attributes: authAttributes({
      ...base.attributes,
      email,
      slackUserId: userId,
      isWriteApprover: isWriteApprover(email),
      isSpendApprover: isSpendApprover(email),
    }),
  }
}

export default slackChannel({
  credentials,

  /**
   * Pull in the thread's earlier messages, but only what is new since the
   * agent's last reply. A marketing ops thread is often ten people deciding
   * something before anyone asks the agent to act, and that context is the
   * difference between a useful answer and "which campaign?". Scoping it to
   * the last agent reply keeps repeated mentions from re-sending the whole
   * thread every time.
   */
  threadContext: { since: "last-agent-reply" },

  async onAppMention(ctx, message) {
    if (!channelAllowed(message.channelId)) return null
    const auth = await authWithEmail(ctx, message)
    if (!auth) return null
    await ctx.thread.startTyping("Thinking…")
    return { auth }
  },

  async onDirectMessage(ctx, message) {
    if (!channelAllowed(message.channelId)) return null
    const auth = await authWithEmail(ctx, message)
    if (!auth) return null
    await ctx.thread.startTyping("Thinking…")
    return { auth }
  },

  /**
   * Unmentioned replies in a thread the agent is already part of. Without this,
   * every follow-up needs another @mention, which reads as clumsy in a
   * conversation. Requires the `message.channels` event and `channels:history`
   * scope; harmless if those are not granted.
   *
   * Gated by `gateReply`, which only answers when the agent is mid-exchange —
   * its own message was the previous one, and it asked for something. Without
   * that the agent answered every message in its thread, including people
   * talking to each other.
   */
  async onMessage(ctx, message) {
    if (message.author?.isBot) return null
    if (!channelAllowed(message.channelId)) return null

    const text = message.text.trim()

    // `/new` starts over: retires the session, its history, and its sandbox.
    // Useful when a long thread has drifted and the context is working against
    // the answer.
    if (text === "/new") {
      await ctx.reset({ reason: "Slack user asked for a fresh conversation" })
      await ctx.thread.post(
        "Started a fresh conversation. Previous context, files, and pending approvals in this thread are cleared."
      )
      return null
    }

    // `/quiet` and `/unquiet` toggle the mute for the whole thread. Handled
    // here rather than as a Slack slash command so it works in the thread the
    // agent is actually being annoying in, with no extra app config.
    if (text === "/quiet" || text === "/unquiet") {
      await setThreadMuted(ctx, message, text === "/quiet")
      return null
    }

    if (!(await ctx.isSubscribed())) return null

    const [history, botUserId] = await Promise.all([
      readThreadTail(ctx, message),
      resolveBotUserId(ctx),
    ])
    if (!gateReply({ message, history, botUserId }).reply) return null

    const auth = await authWithEmail(ctx, message)
    return auth ? { auth } : null
  },

  /**
   * Who may answer an approval prompt.
   *
   * eve decides *whether* a call needs a human (the policies in
   * `agent/lib/approval.ts`); this decides *which* humans count. Without it,
   * anyone who can see the thread could approve their own CRM write, which
   * would make the whole gate decorative.
   *
   * Returning the responder's auth also makes them the resumed turn's
   * `auth.current`, which is what lets the Google Ads tools verify at execution
   * time that a *spend* approver — not merely any approver — signed off.
   */
  async onInputResponse(ctx, submission) {
    const userId = submission.user.id

    let email: string | undefined
    try {
      const response = await ctx.slack.request("users.info", { user: userId })
      if (response.ok) {
        const user = response.user as { profile?: { email?: string } } | undefined
        email = user?.profile?.email
      }
    } catch {
      // Fall through: no email means not an approver.
    }

    const approver = isWriteApprover(email) || isSpendApprover(email)
    if (!approver) {
      // Reject, but say why. Silently ignoring the click looks like a bug, and
      // the person would just keep pressing it. The request stays pending and
      // its buttons stay live for someone who is allowed.
      await ctx.thread.postEphemeral(
        userId,
        config.approvers.writes.length > 0 || config.approvers.spend.length > 0
          ? `You are not on ${config.botName}'s approver list, so that approval was not recorded. Ask ${
              config.approverGroupId ? `<!subteam^${config.approverGroupId}>` : "an approver"
            } to review it.`
          : `${config.botName} has no approvers configured yet, so nobody can approve this. Set AUTHORIZED_USER_EMAILS and redeploy.`
      )
      return null
    }

    return {
      auth: {
        ...ctx.defaultAuth,
        attributes: authAttributes({
          ...ctx.defaultAuth.attributes,
          email,
          slackUserId: userId,
          isWriteApprover: isWriteApprover(email),
          isSpendApprover: isSpendApprover(email),
        }),
      },
    }
  },

  /**
   * Events that are not messages: the App Home tab and emoji reactions.
   *
   * `onEvent` is the raw fallback after the message hooks, so anything here is
   * something no message handler claimed.
   */
  async onEvent(ctx, event) {
    const raw = event as { type?: string; user?: string; item?: { channel?: string; ts?: string }; reaction?: string }

    /**
     * App Home. This is the only surface where someone can find out what the
     * agent does without guessing a prompt, so it is worth keeping accurate —
     * it renders from the live integration registry rather than a static list.
     */
    if (raw.type === "app_home_opened" && raw.user) {
      await ctx.slack.request("views.publish", {
        user_id: raw.user,
        view: JSON.stringify(buildHomeView()),
      })
      return
    }

    /**
     * :bug: on any message files it, with the thread as context.
     *
     * The cheapest possible path from "this is broken" to a written ticket:
     * nobody has to leave the conversation or re-describe the problem. Requires
     * the `reaction_added` event and `reactions:read`.
     */
    if (
      raw.type === "reaction_added" &&
      raw.reaction === "bug" &&
      raw.item?.channel &&
      raw.item?.ts &&
      channelAllowed(raw.item.channel)
    ) {
      await ctx.send(
        "Someone added a :bug: reaction to a message in this thread. Read the thread, work out what is broken, and file it in the project tracker — you write the title and body, and include enough context that an engineer can pick it up cold. Reply with the issue URL. If the thread does not actually describe a defect, say so instead of filing something vague.",
        {
          target: { channelId: raw.item.channel, threadTs: raw.item.ts },
          auth: null,
          title: "Bug filed from a reaction",
        }
      )
      return
    }
  },

  events: {
    /**
     * Attach files the agent wrote to the thread.
     *
     * Any tool that returns a `/workspace` path — `export_salesforce_query`, or
     * a chart the agent rendered in the sandbox — gets its file uploaded here.
     * `action.result` handlers see the tool's *full* output even when
     * `toModelOutput` shows the model only a summary, which is exactly the split
     * we want: the model reasons about "48,210 rows, 12 columns" while the human
     * gets the actual spreadsheet.
     *
     * This is why CSV export no longer needs the old "did the user say the word
     * csv?" keyword sniffing in the events route — the agent decides to export,
     * and the file follows.
     */
    async "action.result"(data, channel, ctx) {
      const result = data.result
      if (result.kind !== "tool-result" || data.status !== "completed") return

      const output = (result.output ?? null) as
        | { path?: unknown; filename?: unknown; bytes?: unknown }
        | null
      const path = typeof output?.path === "string" ? output.path : null
      if (!path || !path.startsWith("/workspace/")) return

      // Slack's own limit is generous, but a giant upload is slow and rarely
      // what someone wants in a thread. Leave the file in the sandbox and say so.
      const bytes = typeof output?.bytes === "number" ? output.bytes : 0
      if (bytes > 45 * 1024 * 1024) {
        await channel.thread.post(
          `The export is ${(bytes / 1024 / 1024).toFixed(1)} MB, too large to attach. It is at \`${path}\` in the workspace if you want it summarized or split.`
        )
        return
      }

      try {
        const sandbox = await ctx.getSandbox()
        const content = await sandbox.readBinaryFile({ path })
        const filename =
          typeof output?.filename === "string"
            ? output.filename
            : path.split("/").pop() || "export.csv"

        await channel.thread.post({
          text: `Here is \`${filename}\`.`,
          files: [{ data: content, filename }],
        })
      } catch (error) {
        // The reply itself still lands; only the attachment is lost.
        console.warn("[slack] Failed to attach workspace file", path, error)
      }
    },
  },
})
