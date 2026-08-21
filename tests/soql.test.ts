/**
 * The read-only SOQL guard.
 *
 * This runs before every query the agent or the console sends. SOQL is read-only
 * by spec, so these cases are belt-and-braces against the ways a mutation can be
 * smuggled into something that looks like a SELECT.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { validateReadOnlySoql } from "../agent/lib/soql"

test("allows an ordinary SELECT", () => {
  assert.equal(validateReadOnlySoql("SELECT Id, Name FROM Contact").ok, true)
})

test("rejects DML", () => {
  for (const soql of [
    "UPDATE Contact SET x=1",
    "DELETE FROM Contact",
    "INSERT INTO Contact",
    "UPSERT Contact",
  ]) {
    assert.equal(validateReadOnlySoql(soql).ok, false, soql)
  }
})

test("rejects statement stacking", () => {
  assert.equal(validateReadOnlySoql("SELECT Id FROM A; DELETE B").ok, false)
})

test("rejects DML hidden behind a comment", () => {
  assert.equal(validateReadOnlySoql("/* harmless */ DELETE FROM Contact").ok, false)
  assert.equal(validateReadOnlySoql("-- note\nDELETE FROM Contact").ok, false)
})

test("rejects FOR UPDATE row locking", () => {
  assert.equal(validateReadOnlySoql("SELECT Id FROM Contact FOR UPDATE").ok, false)
})

test("rejects anything that is not a SELECT at all", () => {
  assert.equal(validateReadOnlySoql("").ok, false)
  assert.equal(validateReadOnlySoql("   ").ok, false)
})
