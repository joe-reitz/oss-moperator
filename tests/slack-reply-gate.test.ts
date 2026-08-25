/**
 * When an un-mentioned Slack message should start a turn.
 *
 * `onMessage` fires on every human message in a thread the agent has joined,
 * so the gate is the only thing keeping it out of side conversations. Each case
 * below is something the agent actually replied to when it should have stayed
 * quiet, or something it must keep answering.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { wantsAgentReply } from "../agent/channels/slack"

test("answers a plain follow-up, which is why onMessage exists at all", () => {
  assert.equal(wantsAgentReply({ text: "rebuild it with the CTA this time" }), true)
})

test("stays out of a message addressed to a teammate", () => {
  // The real one: tagging a colleague to show them the thread.
  assert.equal(
    wantsAgentReply({
      text: "<@U53V864G0> this was objectively a terrible prompt but the hardest part was setting up a brand",
    }),
    false
  )
})

test("ignores a screenshot drop with no typed text", () => {
  assert.equal(wantsAgentReply({ text: "", attachments: [{}, {}, {}] }), false)
})

test("still answers a screenshot that comes with an actual request", () => {
  assert.equal(
    wantsAgentReply({ text: "this link looks wrong, can you fix it?", attachments: [{}] }),
    true
  )
})

test("ignores whitespace and bare link paste", () => {
  assert.equal(wantsAgentReply({ text: "   " }), false)
  assert.equal(wantsAgentReply({ text: "<https://enterprise.knak.io/builder/123>" }), true)
})

test("a broadcast alone does not silence it", () => {
  // @here is not addressed to anyone in particular, so the text still decides.
  assert.equal(wantsAgentReply({ text: "<!here> can someone rebuild this email" }), true)
  assert.equal(wantsAgentReply({ text: "<!here>" }), false)
})

test("Enterprise Grid user ids are recognized as mentions", () => {
  assert.equal(wantsAgentReply({ text: "<@W012ABCDEF> take a look" }), false)
})
