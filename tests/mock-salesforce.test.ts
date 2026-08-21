/**
 * The mock Salesforce org.
 *
 * Its whole purpose is that someone with no credentials can exercise the CRM
 * tools, so these tests are also the demonstration that they can. If the mock
 * drifts from the real client's contract, the tools break for contributors only
 * — which nobody would notice without this file.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

// Set before any call, not before import: the client reads this at call time.
process.env.MOPERATOR_MOCK = "true"

import {
  addToCampaign,
  bulkUpdateRecords,
  createRecord,
  createRecords,
  deleteRecord,
  describeGlobal,
  describeObject,
  isSalesforceConfigured,
  query,
  queryAllRecords,
  updateRecord,
} from "../agent/lib/salesforce/client"
import { resetMockOrg } from "../agent/lib/salesforce/mock"

test("mock mode counts as configured, so the tools are advertised", () => {
  assert.equal(isSalesforceConfigured(), true)
})

test("queries the seeded org", async () => {
  resetMockOrg()
  const campaigns = await query("SELECT Id, Name, Status FROM Campaign")
  assert.equal(campaigns.length, 3)
  assert.ok(campaigns.every((row) => row._mock === true))
})

test("filters with = and IN, and honours LIMIT", async () => {
  resetMockOrg()
  assert.equal((await query("SELECT Id FROM Campaign WHERE Type = 'Webinar'")).length, 1)
  assert.equal(
    (
      await query(
        "SELECT Id, Email FROM Contact WHERE Email IN ('ada@acme.example','nobody@x.com')"
      )
    ).length,
    1
  )
  assert.equal((await query("SELECT Id FROM Contact LIMIT 2")).length, 2)
})

test("resolves a one-hop relationship, which is the common traversal", async () => {
  resetMockOrg()
  const rows = await query("SELECT Id, Email, Account.Name FROM Contact LIMIT 1")
  assert.equal((rows[0].Account as { Name: string }).Name, "Acme Corp")
})

test("COUNT() returns rows to count rather than a value", async () => {
  resetMockOrg()
  assert.equal((await query("SELECT COUNT() FROM Contact")).length, 3)
})

test("seeds an opted-out contact, so list hygiene has something to catch", async () => {
  resetMockOrg()
  const optedOut = await query(
    "SELECT Id, Email FROM Contact WHERE HasOptedOutOfEmail = 'true'"
  )
  assert.equal(optedOut.length, 1)
})

test("writes are observable through a subsequent read", async () => {
  resetMockOrg()
  const id = await createRecord("Lead", { Email: "new@x.com", Company: "NewCo" })
  assert.match(id, /^00QMOCK/)
  assert.equal((await query("SELECT Id FROM Lead")).length, 3)

  await updateRecord("Lead", id, { Status: "Working - Contacted" })
  const updated = await query(`SELECT Id, Status FROM Lead WHERE Id = '${id}'`)
  assert.equal(updated[0].Status, "Working - Contacted")

  await deleteRecord("Lead", id)
  assert.equal((await query("SELECT Id FROM Lead")).length, 2)
})

test("bulk insert and bulk update work, which is the list-import path", async () => {
  resetMockOrg()
  const result = await createRecords("Lead", [
    { Email: "a@x.com", Company: "A" },
    { Email: "b@x.com", Company: "B" },
  ])
  assert.equal(result.created.length, 2)
  assert.equal(result.failed.length, 0)
  assert.equal((await query("SELECT Id FROM Lead")).length, 4)

  const bulk = await bulkUpdateRecords("Lead", [
    { Id: result.created[0], Status: "Qualified" },
  ])
  assert.equal(bulk.success, 1)
})

test("campaign membership is created", async () => {
  resetMockOrg()
  const added = await addToCampaign("701MOCK00000001", ["003MOCK00000003"], "Sent")
  assert.equal(added.success, 1)
  assert.equal((await query("SELECT Id FROM CampaignMember")).length, 3)
})

test("describe reports fields derived from the seed", async () => {
  resetMockOrg()
  const described = await describeObject("Contact")
  const names = described.fields.map((field) => field.name)
  assert.ok(names.includes("Email"))
  assert.ok(names.includes("HasOptedOutOfEmail"))
  assert.ok(described.fields.find((f) => f.name === "Id")!.updateable === false)

  const global = await describeGlobal()
  assert.ok(global.sobjects.map((entry) => entry.name).includes("Campaign"))
})

test("an unknown object errors helpfully rather than returning nothing", async () => {
  resetMockOrg()
  await assert.rejects(
    () => describeObject("Widget__c"),
    /has no Widget__c object.*Available/s
  )
})

test("queryAllRecords goes through the mock too", async () => {
  resetMockOrg()
  assert.equal((await queryAllRecords("SELECT Id FROM Account")).length, 3)
})
