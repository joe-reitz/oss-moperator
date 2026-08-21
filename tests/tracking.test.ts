/**
 * UTM normalization.
 *
 * One `paid_social` among a thousand `paid-social` splits a channel in every
 * downstream report, and nobody notices until someone is reviewing the quarter.
 * Normalizing at link-creation time is the whole point of the tracking tools.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { normalizeToken } from "../agent/lib/tracking"

test("collapses the separators that fragment a channel", () => {
  assert.equal(normalizeToken("Paid_Social"), "paid-social")
  assert.equal(normalizeToken("Paid Social"), "paid-social")
  assert.equal(normalizeToken("a---b"), "a-b")
})

test("strips punctuation and edge hyphens", () => {
  assert.equal(normalizeToken("  Q1 Webinar!! "), "q1-webinar")
  assert.equal(normalizeToken("-lead-"), "lead")
})

test("keeps dots, which appear in real source names", () => {
  assert.equal(normalizeToken("acme.com"), "acme.com")
})
