/**
 * Guard rails for the Customer.io, Iterable, and Inflection clients.
 *
 * None of these tests make a network call. What they pin is the checks that run
 * *before* the network — the ones that turn a silent data-loss bug or a confusing
 * 4xx into a message that says what to fix. Those are exactly the parts worth
 * regression-testing, because they are easy to delete by accident and their
 * absence is invisible until someone loses data.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  MAX_BATCH,
  assertSnakeCaseKeys,
  upsertContacts,
} from "../agent/lib/inflection/client"
import {
  MAX_PER_CALL,
  sendEmailToUser,
  updateUser,
} from "../agent/lib/iterable/client"

describe("Inflection snake_case guard", () => {
  it("accepts snake_case keys", () => {
    assert.doesNotThrow(() =>
      assertSnakeCaseKeys({ first_name: "Jane", company_name: "Acme" })
    )
  })

  it("accepts the underscore-prefixed keys Inflection sets itself", () => {
    assert.doesNotThrow(() => assertSnakeCaseKeys({ _source: "api" }))
  })

  it("accepts keys with digits", () => {
    assert.doesNotThrow(() => assertSnakeCaseKeys({ utm_term_2: "x" }))
  })

  it("accepts an empty property bag", () => {
    assert.doesNotThrow(() => assertSnakeCaseKeys({}))
  })

  // This is the whole point: Inflection accepts camelCase, reports success, and
  // stores null. There is no later error to catch, so if this check regresses the
  // failure mode is silent data loss.
  it("rejects camelCase, which Inflection would silently store as null", () => {
    assert.throws(() => assertSnakeCaseKeys({ firstName: "Jane" }), /snake_case/)
  })

  it("suggests the correct conversion", () => {
    assert.throws(
      () => assertSnakeCaseKeys({ firstName: "Jane" }),
      /firstName → first_name/
    )
  })

  it("names every offender, not just the first", () => {
    assert.throws(
      () => assertSnakeCaseKeys({ firstName: "a", lastName: "b", ok_key: "c" }),
      (error: Error) =>
        error.message.includes("firstName → first_name") &&
        error.message.includes("lastName → last_name") &&
        !error.message.includes("ok_key")
    )
  })

  it("splits runs of capitals in a readable way", () => {
    assert.throws(
      () => assertSnakeCaseKeys({ utmSource: "x" }),
      /utmSource → utm_source/
    )
  })

  it("labels where the bad keys came from", () => {
    assert.throws(
      () => assertSnakeCaseKeys({ badKey: 1 }, "contact properties"),
      /contact properties keys must be snake_case/
    )
  })
})

describe("Inflection batch limits", () => {
  it("matches the documented ceiling of 1,000 per transaction", () => {
    assert.equal(MAX_BATCH, 1000)
  })

  it("refuses an oversized batch before making a request", async () => {
    const contacts = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      email: `person${i}@example.com`,
    }))

    // No token is set in the test environment, so if this reached the network
    // layer it would fail with a configuration error instead. Asserting on the
    // batch message proves the size check runs first.
    await assert.rejects(() => upsertContacts(contacts), /at most 1000 contacts/)
  })

  it("checks property keys before checking the batch size", async () => {
    const contacts = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      email: `person${i}@example.com`,
      properties: { firstName: "Jane" },
    }))

    // Both are wrong; the key problem is the one that loses data silently, so it
    // should be the one reported.
    await assert.rejects(() => upsertContacts(contacts), /snake_case/)
  })
})

describe("Iterable identity guards", () => {
  it("matches the documented 1,000-per-call ceiling", () => {
    assert.equal(MAX_PER_CALL, 1000)
  })

  // Iterable keys profiles on email or userId. A write with neither cannot be
  // attributed to anyone, and Iterable's own error for it is unhelpful.
  it("refuses a user write with neither an email nor a userId", async () => {
    await assert.rejects(
      () => updateUser({ dataFields: { plan: "pro" } }),
      /either an email or a userId/
    )
  })

  it("refuses a send with no recipient", async () => {
    await assert.rejects(
      () => sendEmailToUser({ campaignId: 1 }),
      /recipientEmail or recipientUserId/
    )
  })
})
