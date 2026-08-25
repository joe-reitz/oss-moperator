/**
 * Whether an un-mentioned Slack message should start a turn.
 *
 * `onMessage` fires on every human message in a thread the agent has joined.
 * That is what lets "rebuild it with the CTA" work without re-@mentioning, and
 * it is also why the agent answered a screenshot drop, a message tagging a
 * colleague, and the word "testing" — from its side, every message in the
 * thread was addressed to it.
 *
 * Letting the model decide whether to stay quiet does not fix this. It already
 * knew: it replied "I don't see a new request in that message", named the
 * teammate the message was actually for, and promised "I'll stop
 * auto-responding" — then answered the next three messages, because whether to
 * reply is settled here, before a model ever runs.
 *
 * So the rule is conversational turn-taking, decided from the thread itself:
 *
 *   **The agent speaks when it is mid-exchange.** Its own message must be the
 *   one immediately preceding, and that message must have asked for something.
 *   Anything else waits for an @mention.
 *
 * A question is the signal because it is what actually creates an obligation to
 * answer. "Want me to run a build?" earns the next message; "Standing by."
 * does not.
 *
 * Everything here is derived from Slack — no external store — because the
 * alternative degrades silently. `getRedis()` returns null when Upstash is
 * unconfigured, which is the state this project deploys in, so a Redis-backed
 * mute would have been another promise the agent could not keep.
 */

/**
 * Slack user mention, e.g. `<@U012ABC>`. Workspace ids start with `U`; `W` is
 * an Enterprise Grid org user. Deliberately not matching `<!here>`,
 * `<!channel>`, or `<!subteam^…>` — a broadcast is addressed to nobody in
 * particular, so it should not by itself silence the agent.
 */
const USER_MENTION = /<@[UW][A-Z0-9]+>/

/** Reaction on the thread root that mutes the agent for the whole thread. */
export const MUTE_REACTION = "mute"

/**
 * Strip the markup that carries no request — mentions, broadcasts, and the
 * `<url>` / `<url|label>` wrappers Slack puts around links. What is left is
 * what the person actually typed.
 */
export function substantiveText(text: string): string {
  return (text || "")
    .replace(new RegExp(USER_MENTION.source, "g"), " ")
    .replace(/<!(?:here|channel|everyone)>/g, " ")
    .replace(/<!subteam\^[^>]+>/g, " ")
    .replace(/<((?:https?|mailto):[^>|]+)\|([^>]*)>/gi, "$2")
    .replace(/<((?:https?|mailto):[^>]+)>/gi, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Did this agent message ask the human for something?
 *
 * A literal `?` is most of it. The rest are the imperatives the agent actually
 * ends turns with — "let me know", "point me at what to verify", "say the word"
 * — which are requests without the punctuation. Kept to an explicit list
 * rather than anything cleverer, because a false positive here re-opens the
 * exact behaviour this module exists to stop.
 */
const ASKS = [
  /\?/,
  /\blet me know\b/i,
  /\bpoint me at\b/i,
  /\bsay the word\b/i,
  /\btell me\b/i,
  /\bgive me\b/i,
  /\bsend me\b/i,
  /\bwhich (?:one|of these)\b/i,
  /\bconfirm\b/i,
  /\bwaiting (?:on|for) you\b/i,
]

export function asksForSomething(text: string): boolean {
  const body = substantiveText(text)
  if (!body) return false
  return ASKS.some((pattern) => pattern.test(body))
}

/** The shape this module needs from a Slack message. Keeps tests free of eve. */
export interface GateMessage {
  readonly text: string
  readonly attachments?: readonly unknown[]
}

/** A prior thread message, as `conversations.replies` returns it. */
export interface ThreadMessage {
  readonly text?: string
  readonly ts?: string
  /** Set on any message posted by an app. */
  readonly bot_id?: string
  readonly user?: string
  readonly subtype?: string
  readonly reactions?: readonly { readonly name?: string }[]
}

export type GateDecision =
  | { reply: true }
  | { reply: false; reason: "muted" | "addressed-to-someone-else" | "no-request" | "not-mid-exchange" }

/**
 * Decide whether to answer.
 *
 * `history` is the thread's messages in Slack order, oldest first, and must
 * include the inbound message as its last entry — that is what
 * `conversations.replies` returns. `history[0]` is the thread root, which is
 * where the mute reaction lives.
 */
export function gateReply(input: {
  message: GateMessage
  history: readonly ThreadMessage[]
  botUserId?: string
}): GateDecision {
  const { message, history, botUserId } = input

  // A muted thread stays muted regardless of what was said. Checked first so
  // the reason reported is the one a human would give.
  const root = history[0]
  if (root?.reactions?.some((reaction) => reaction?.name === MUTE_REACTION)) {
    return { reply: false, reason: "muted" }
  }

  // Safe to key on the mention alone: eve routes `app_mention` to
  // `onAppMention`, so anything arriving here did not mention the agent — which
  // makes any user mention here someone *else* being addressed.
  if (USER_MENTION.test(message.text || "")) {
    return { reply: false, reason: "addressed-to-someone-else" }
  }

  // No typed text is no request. A screenshot drop lands here. Text *plus*
  // attachments still counts, because "this link looks wrong, fix it?" with a
  // screenshot is a real ask.
  if (!substantiveText(message.text)) {
    return { reply: false, reason: "no-request" }
  }

  // Mid-exchange: the agent's own message must be the one immediately before
  // this, and it must have asked for something. Slack orders replies oldest
  // first and includes the inbound message, so the candidate is second-to-last.
  const previous = previousMessage(history)
  if (!previous || !isAgentMessage(previous, botUserId)) {
    return { reply: false, reason: "not-mid-exchange" }
  }
  if (!asksForSomething(previous.text ?? "")) {
    return { reply: false, reason: "not-mid-exchange" }
  }

  return { reply: true }
}

/**
 * The message before the inbound one.
 *
 * Slack's thread history includes join/leave notices and other subtyped
 * system messages. Skipping them means a "so-and-so joined the channel"
 * landing between the agent's question and the answer does not break the
 * exchange.
 */
function previousMessage(
  history: readonly ThreadMessage[]
): ThreadMessage | undefined {
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const candidate = history[index]
    if (!candidate) continue
    if (candidate.subtype && candidate.subtype !== "bot_message") continue
    return candidate
  }
  return undefined
}

/**
 * Was this message posted by us?
 *
 * `bot_id` alone would also match other apps in the channel, and being asked a
 * question by a different bot should not make this agent answer. When the bot's
 * own user id is known it is the authority; `bot_id` is the fallback for
 * workspaces where the id is not resolvable.
 */
function isAgentMessage(message: ThreadMessage, botUserId?: string): boolean {
  if (botUserId) return message.user === botUserId
  return !!message.bot_id
}
