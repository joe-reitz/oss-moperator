/**
 * The Knak generation prompt.
 *
 * Every assertion here corresponds to a line in the prompt that exists because
 * something went wrong without it. They are guarding against a well-meaning
 * edit that makes the prompt read better and reintroduces the failure.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildAssetName,
  buildGenerationPrompt,
  normalizeSlackText,
  slackBoldToMarkdown,
} from "../agent/lib/knak/brief"

const prompt = buildGenerationPrompt({
  bodyCopy: "Hello **world**\n- one\n- two",
  subject: "Subject here",
  preheader: "Preview",
  ctaText: "Learn more",
  ctaLink: "https://acme.com/x",
  brand: "Acme",
})

test("forbids the rewriting that ruins approved copy", () => {
  assert.match(prompt, /Do not rewrite, summarize, paraphrase/)
})

test("fences the section list against invented blocks", () => {
  assert.match(prompt, /INCLUDE ONLY THE SECTIONS LISTED BELOW/)
  assert.match(prompt, /placeholder\/lorem-ipsum/)
})

test("protects theme styling that used to drift", () => {
  assert.match(prompt, /do NOT change the color, thickness, or style of any divider/)
})

test("keeps the subject out of the body as a headline", () => {
  assert.match(prompt, /inbox subject ONLY/)
})

test("requires link text rather than a bare URL", () => {
  assert.match(prompt, /DISPLAY THE LINK TEXT/)
})

test("reproduces the copy verbatim, prohibitions first", () => {
  assert.ok(prompt.includes("Hello **world**\n- one\n- two"))
  assert.ok(prompt.indexOf("Do not rewrite") < prompt.indexOf("Hello **world**"))
})

test("renders the CTA with or without a label", () => {
  assert.match(prompt, /label "Learn more" linking to https:\/\/acme\.com\/x/)
  assert.match(
    buildGenerationPrompt({ bodyCopy: "x", ctaLink: "https://a.co" }),
    /Call-to-action button linking to https:\/\/a\.co/
  )
})

test("applies the naming convention, collapsing empty tokens", () => {
  assert.equal(
    buildAssetName({
      region: "NAMER",
      type: "Email",
      brand: "Acme",
      title: "AI SDK Launch",
      targetSendDate: "2026-09-14",
      ticket: "MOPS-4520",
    }),
    "NAMER_em_Acme_AI-SDK-Launch_20260914_MOPS-4520"
  )
  // No "__" gaps when parts are missing — Knak cannot rename later.
  assert.equal(buildAssetName({ region: "EMEA", title: "Webinar" }), "EMEA_Webinar")
  assert.equal(buildAssetName({ type: "Nurture", title: "Onboarding" }), "nur_Onboarding")
  assert.equal(buildAssetName({}), "")
})

test("un-garbles Slack's escaping, which once produced empty emails", () => {
  // Left alone, "-&gt;" made the builder treat the copy as junk and fall back
  // to a bare theme scaffold.
  assert.equal(normalizeSlackText("step one -&gt; step two"), "step one -> step two")
  assert.equal(normalizeSlackText("https://a.co/?x=1&amp;y=2"), "https://a.co/?x=1&y=2")
  assert.equal(
    normalizeSlackText("<https://a.co|Watch the recording>"),
    "[Watch the recording](https://a.co)"
  )
  assert.equal(normalizeSlackText("<https://a.co>"), "https://a.co")
})

test("upgrades Slack bold, which markdown would read as italic", () => {
  assert.equal(slackBoldToMarkdown("this is *bold* here"), "this is **bold** here")
  assert.equal(slackBoldToMarkdown("a *b\nc* d"), "a *b\nc* d")
})
