/**
 * When an un-mentioned Slack message should start a turn.
 *
 * `onMessage` fires on every human message in a thread the agent has joined, so
 * this gate is the only thing keeping it out of conversations that are not its
 * own. Most cases below are transcribed from a real thread where the agent
 * answered all of them, including "testing" and an insult.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  asksForSomething,
  gateReply,
  MUTE_REACTION,
  substantiveText,
  type ThreadMessage,
} from "../agent/lib/slack-reply-gate"

const BOT = "U0BOT"
const HUMAN = "U0HUMAN"

const root: ThreadMessage = { ts: "1.0", user: HUMAN, text: "build an email about you" }

/** Thread history ending in the inbound message, as conversations.replies returns it. */
function history(...tail: ThreadMessage[]): ThreadMessage[] {
  return [root, ...tail]
}

function agent(text: string): ThreadMessage {
  return { ts: "2.0", user: BOT, bot_id: "B0MOP", text }
}

function human(text: string): ThreadMessage {
  return { ts: "3.0", user: HUMAN, text }
}

function decide(text: string, tail: ThreadMessage[], attachments?: unknown[]) {
  return gateReply({
    message: { text, attachments },
    history: [...history(...tail), human(text)],
    botUserId: BOT,
  })
}

// ── The exchange the gate exists to preserve ────────────────────────────────

test("answers a reply to the agent's own question", () => {
  const decision = decide("ffs it's to make you quit auto-responding", [
    agent("Got it. Want me to run a build to exercise it? Just point me at what to verify."),
  ])
  assert.equal(decision.reply, true)
})

test("answers a follow-up to a question with no question mark", () => {
  const decision = decide("use the pricing page", [
    agent("Give me the destination URL and I'll build a tracked link."),
  ])
  assert.equal(decision.reply, true)
})

test("a system message between the question and the answer does not break it", () => {
  const decision = decide("NAMER", [
    agent("Which region should this go to?"),
    { ts: "2.5", user: "U0OTHER", subtype: "channel_join", text: "has joined the channel" },
  ])
  assert.equal(decision.reply, true)
})

// ── The chatter it must stay out of ─────────────────────────────────────────

test("stays silent after its own statement, which is the reported bug", () => {
  const decision = decide("testing", [agent("Understood — I'll stop auto-responding.")])
  assert.equal(decision.reply, false)
  assert.equal(decision.reply === false && decision.reason, "not-mid-exchange")
})

test("does not answer an insult after 'Standing by.'", () => {
  const decision = decide("you son of a bitch", [agent("Standing by.")])
  assert.equal(decision.reply, false)
})

test("stays out of a message addressed to a teammate", () => {
  const decision = decide(
    "<@U53V864G0> this was objectively a terrible prompt but the hardest part was the sandbox",
    [agent("Want me to take the next step?")]
  )
  assert.equal(decision.reply, false)
  assert.equal(decision.reply === false && decision.reason, "addressed-to-someone-else")
})

test("ignores a screenshot drop with no typed text", () => {
  const decision = decide("", [agent("Want me to take the next step?")], [{}, {}, {}])
  assert.equal(decision.reply, false)
  assert.equal(decision.reply === false && decision.reason, "no-request")
})

test("still answers a screenshot that comes with a request", () => {
  const decision = decide("this link looks wrong, can you fix it?", [
    agent("Anything else you want checked?"),
  ], [{}])
  assert.equal(decision.reply, true)
})

test("does not answer when a human spoke last", () => {
  const decision = decide("and another thing", [
    agent("Want me to rebuild it?"),
    human("hang on"),
  ])
  assert.equal(decision.reply, false)
})

test("a question from a different bot does not summon it", () => {
  // my-krewe lives in the same channel. Its questions are not this agent's.
  const decision = decide("sure", [
    { ts: "2.0", user: "U0KREWE", bot_id: "B0KREWE", text: "Want a duck?" },
  ])
  assert.equal(decision.reply, false)
})

test("fails closed when the thread cannot be read", () => {
  // readThreadTail returns [] on any Slack failure. No history, no exchange.
  const decision = gateReply({ message: { text: "hello" }, history: [], botUserId: BOT })
  assert.equal(decision.reply, false)
})

// ── Mute ───────────────────────────────────────────────────────────────────

test("a muted thread stays silent even mid-exchange", () => {
  const decision = gateReply({
    message: { text: "yes please" },
    history: [
      { ...root, reactions: [{ name: MUTE_REACTION }] },
      agent("Want me to rebuild it?"),
      human("yes please"),
    ],
    botUserId: BOT,
  })
  assert.equal(decision.reply, false)
  assert.equal(decision.reply === false && decision.reason, "muted")
})

test("an unrelated reaction on the root does not mute", () => {
  const decision = gateReply({
    message: { text: "yes please" },
    history: [
      { ...root, reactions: [{ name: "tada" }] },
      agent("Want me to rebuild it?"),
      human("yes please"),
    ],
    botUserId: BOT,
  })
  assert.equal(decision.reply, true)
})

// ── Helpers ────────────────────────────────────────────────────────────────

test("recognizes an ask with and without punctuation", () => {
  assert.equal(asksForSomething("Want me to run a build?"), true)
  assert.equal(asksForSomething("Just point me at what to verify."), true)
  assert.equal(asksForSomething("Say the word and I'll push."), true)
  assert.equal(asksForSomething("Standing by."), false)
  assert.equal(asksForSomething("Understood — I'll stop auto-responding."), false)
  assert.equal(asksForSomething(""), false)
})

test("strips markup that carries no request", () => {
  assert.equal(substantiveText("<@U012ABC>"), "")
  assert.equal(substantiveText("<!here>"), "")
  assert.equal(substantiveText("   "), "")
  assert.equal(substantiveText("<https://knak.io/builder/1>"), "https://knak.io/builder/1")
  assert.equal(substantiveText("see <https://x.co|the docs>"), "see the docs")
})
