/**
 * Tracker selection and cross-provider normalization.
 *
 * Five providers with different vocabularies sit behind one tool surface, so the
 * risk is a request going to the wrong tracker, or a priority being silently
 * mistranslated between numbering schemes that disagree.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isTrackerConfigured,
  resolveProvider,
  trackerSummary,
} from "../agent/lib/trackers"
import { toAdf } from "../agent/lib/trackers/jira"
import { priorityFromName } from "../agent/lib/trackers/types"

const TRACKER_VARS = [
  "LINEAR_API_KEY",
  "ASANA_ACCESS_TOKEN",
  "JIRA_SITE",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "MONDAY_API_TOKEN",
  "CLICKUP_API_TOKEN",
  "MOPERATOR_TRACKER",
]

function clearTrackers(): void {
  for (const name of TRACKER_VARS) delete process.env[name]
}

// Every provider's isConfigured() and resolveProvider() read process.env when
// called, not at import time — so mutating the environment per test is enough.

test("no tracker configured means no tracker tools", () => {
  clearTrackers()
  assert.equal(isTrackerConfigured(), false)
  assert.equal(trackerSummary(), null)
})

test("a partial Jira config does not activate", () => {
  clearTrackers()
  process.env.JIRA_SITE = "acme"
  assert.equal(isTrackerConfigured(), false)
})

test("the prompt uses the active provider's own vocabulary", () => {
  clearTrackers()
  process.env.ASANA_ACCESS_TOKEN = "t"
  assert.equal(resolveProvider().id, "asana")
  assert.match(trackerSummary()!, /a "task" and a container a "project"/)
})

test("MOPERATOR_TRACKER decides when several are configured", () => {
  clearTrackers()
  process.env.ASANA_ACCESS_TOKEN = "t"
  process.env.CLICKUP_API_TOKEN = "t"
  process.env.MOPERATOR_TRACKER = "clickup"
  assert.equal(resolveProvider().id, "clickup")
  // An explicit id from the model still wins over the configured default.
  assert.equal(resolveProvider("asana").id, "asana")
})

test("an unconfigured MOPERATOR_TRACKER fails loudly rather than guessing", () => {
  clearTrackers()
  process.env.ASANA_ACCESS_TOKEN = "t"
  process.env.MOPERATOR_TRACKER = "monday"
  assert.throws(() => resolveProvider(), /not configured/)
})

test("priority survives translation between disagreeing schemes", () => {
  // Jira uses names, monday uses its own labels, Linear and ClickUp use 1-4.
  assert.equal(priorityFromName("Highest"), "urgent")
  assert.equal(priorityFromName("Critical"), "urgent")
  assert.equal(priorityFromName("Blocker"), "urgent")
  assert.equal(priorityFromName("Normal"), "medium")
  assert.equal(priorityFromName("Low"), "low")
  // Unknown must be undefined, not a guessed default.
  assert.equal(priorityFromName("Whenever"), undefined)
  assert.equal(priorityFromName(undefined), undefined)
})

test("Jira descriptions become valid ADF, not markdown", () => {
  assert.deepEqual(toAdf(""), { type: "doc", version: 1, content: [] })
  assert.deepEqual(toAdf("One.\n\nTwo."), {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "One." }] },
      { type: "paragraph", content: [{ type: "text", text: "Two." }] },
    ],
  })
  assert.deepEqual(toAdf("- a\n- b"), {
    type: "doc",
    version: 1,
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
          },
        ],
      },
    ],
  })
})
