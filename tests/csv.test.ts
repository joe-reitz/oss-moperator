/**
 * CSV parsing and list-hygiene helpers.
 *
 * These matter more than their size suggests. The input is a spreadsheet a human
 * exported, and every failure mode here is silent: a mangled quoted field or a
 * missed BOM does not throw, it puts wrong data in the CRM. So each case below
 * is a real shape that has broken a naive parser.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  detectEmailColumn,
  EMAIL_PATTERN,
  flattenRecord,
  isFreeMailDomain,
  isRoleAddress,
  normalizeEmail,
  parseCsv,
  recordsToCsv,
} from "../agent/lib/csv"

test("parses the shapes that break split(',')", () => {
  assert.deepEqual(parseCsv('Name,Co\nAda,"Acme, Inc."'), [
    { Name: "Ada", Co: "Acme, Inc." },
  ])
  assert.deepEqual(parseCsv('A\n"say ""hi"""'), [{ A: 'say "hi"' }])
  assert.deepEqual(parseCsv('A,B\n"line1\nline2",x'), [
    { A: "line1\nline2", B: "x" },
  ])
  assert.deepEqual(parseCsv("A,B\r\n1,2"), [{ A: "1", B: "2" }])
})

test("survives Excel's UTF-8 BOM on the first header", () => {
  assert.deepEqual(Object.keys(parseCsv("﻿Email\na@b.co")[0]), ["Email"])
})

test("skips blank lines and pads ragged rows", () => {
  assert.deepEqual(parseCsv("A\n1\n\n\n2"), [{ A: "1" }, { A: "2" }])
  assert.deepEqual(parseCsv("A,B,C\n1,2"), [{ A: "1", B: "2", C: "" }])
})

test("a header-only file has no rows", () => {
  assert.deepEqual(parseCsv("A,B"), [])
})

test("finds the email column however it is labelled", () => {
  assert.equal(detectEmailColumn([{ Email: "a@b.co" }]), "Email")
  assert.equal(detectEmailColumn([{ "Email Address": "a@b.co" }]), "Email Address")
  assert.equal(detectEmailColumn([{ Name: "x", work_email: "a@b.co" }]), "work_email")
})

test("falls back to sampling values when headers are useless", () => {
  assert.equal(
    detectEmailColumn([
      { col1: "Ada", col2: "a@b.co" },
      { col1: "Bob", col2: "c@d.co" },
    ]),
    "col2"
  )
  assert.equal(detectEmailColumn([{ Name: "Ada", City: "NYC" }]), undefined)
})

test("normalizes the casing and spacing that fake most duplicates", () => {
  assert.equal(normalizeEmail("  Ada@Acme.CO "), "ada@acme.co")
})

test("flags role and free-mail addresses", () => {
  assert.equal(isRoleAddress("info@acme.co"), true)
  assert.equal(isRoleAddress("ada@acme.co"), false)
  assert.equal(isFreeMailDomain("a@gmail.com"), true)
  assert.equal(isFreeMailDomain("a@acme.co"), false)
})

test("email validation is permissive but catches real junk", () => {
  assert.deepEqual(
    ["a@b.co", "no-at-sign", "a@b", "a b@c.co"].map((v) => EMAIL_PATTERN.test(v)),
    [true, false, false, false]
  )
})

test("export strips jsforce metadata and flattens relationships", () => {
  assert.deepEqual(
    flattenRecord({
      attributes: { type: "Contact" },
      Id: "003x",
      Account: { attributes: {}, Name: "Acme" },
    }),
    { Id: "003x", "Account.Name": "Acme" }
  )
})

test("export quotes what would otherwise corrupt the file", () => {
  assert.equal(recordsToCsv([{ Name: 'Acme, Inc. "HQ"' }]), 'Name\n"Acme, Inc. ""HQ"""')
  assert.equal(recordsToCsv([{ a: 1 }, { b: 2 }]), "a,b\n1,\n,2")
})
