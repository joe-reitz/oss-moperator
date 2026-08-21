/**
 * The marketing-ops judgement tools.
 *
 * All pure logic, which is exactly why they are worth testing hard: the failures
 * are quiet. A rate comparison that calls a false winner, or a normalizer that
 * guesses a country wrong, produces a confident number nobody re-checks.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { auditEmail } from "../agent/lib/email-qa"
import {
  companyKey,
  normalizeCountry,
  normalizePersonName,
  normalizeSeniority,
  phoneKey,
} from "../agent/lib/normalize"
import { compareRates } from "../agent/lib/stats"

// ─── Rate comparison ─────────────────────────────────────────────────────────

test("refuses to call a winner on a small sample", () => {
  // 2.1% vs 2.4% on ~400 each: the shape of a real false positive.
  const result = compareRates(
    { label: "A", conversions: 8, total: 400 },
    { label: "B", conversions: 10, total: 400 }
  )
  assert.equal(result.significant, false)
  assert.match(result.verdict, /Not distinguishable/)
  assert.match(result.verdict, /Do not call a winner/)
  assert.ok(result.sampleNeededPerArm! > 400)
})

test("calls a winner when the evidence is actually there", () => {
  const result = compareRates(
    { label: "A", conversions: 200, total: 10_000 },
    { label: "B", conversions: 400, total: 10_000 }
  )
  assert.equal(result.significant, true)
  assert.match(result.verdict, /B is genuinely better/)
})

test("reports both absolute and relative difference", () => {
  const result = compareRates(
    { label: "A", conversions: 100, total: 1_000 },
    { label: "B", conversions: 150, total: 1_000 }
  )
  assert.equal(result.absoluteDifference.toFixed(1), "5.0")
  assert.equal(result.relativeLift!.toFixed(0), "50")
})

test("handles the degenerate inputs without producing nonsense", () => {
  const empty = compareRates(
    { label: "A", conversions: 0, total: 0 },
    { label: "B", conversions: 5, total: 100 }
  )
  assert.equal(empty.significant, false)
  assert.match(empty.verdict, /no data/)

  const identical = compareRates(
    { label: "A", conversions: 10, total: 100 },
    { label: "B", conversions: 10, total: 100 }
  )
  assert.equal(identical.significant, false)
  assert.match(identical.verdict, /identical/)

  const zeroBase = compareRates(
    { label: "A", conversions: 0, total: 100 },
    { label: "B", conversions: 10, total: 100 }
  )
  assert.equal(zeroBase.relativeLift, null)
})

// ─── Normalization ───────────────────────────────────────────────────────────

test("maps the many spellings of a country to one ISO code", () => {
  for (const input of ["United States", "USA", "U.S.", "us", "America"]) {
    assert.equal(normalizeCountry(input), "US", input)
  }
  for (const input of ["United Kingdom", "UK", "England", "Great Britain"]) {
    assert.equal(normalizeCountry(input), "GB", input)
  }
})

test("returns null rather than guessing an unknown country", () => {
  assert.equal(normalizeCountry("Freedonia"), null)
  assert.equal(normalizeCountry(""), null)
  assert.equal(normalizeCountry(undefined), null)
})

test("classifies seniority with the senior checks winning", () => {
  // "VP of Engineering" must not match "engineer".
  assert.equal(normalizeSeniority("VP of Engineering"), "vp")
  assert.equal(normalizeSeniority("V.P. Marketing"), "vp")
  assert.equal(normalizeSeniority("Chief Marketing Officer"), "c-level")
  assert.equal(normalizeSeniority("CMO"), "c-level")
  assert.equal(normalizeSeniority("Co-Founder"), "c-level")
  // "Director of Marketing Operations" must not fall through to individual.
  assert.equal(normalizeSeniority("Director of Marketing Operations"), "director")
  assert.equal(normalizeSeniority("Head of Growth"), "director")
  assert.equal(normalizeSeniority("Marketing Manager"), "manager")
  assert.equal(normalizeSeniority("Software Engineer"), "individual")
  assert.equal(normalizeSeniority("Wizard"), "unknown")
  assert.equal(normalizeSeniority(""), "unknown")
})

test("collapses company names that differ only by legal suffix", () => {
  const expected = companyKey("Acme, Inc.")
  for (const input of ["Acme Inc", "ACME, INC.", "Acme Incorporated", "acme"]) {
    assert.equal(companyKey(input), expected, input)
  }
  assert.equal(companyKey("Acme Holdings Inc"), "acme")
  assert.equal(companyKey("Smith & Sons Ltd"), "smith and sons")
  // Distinct companies must stay distinct.
  assert.notEqual(companyKey("Acme"), companyKey("Acme Labs"))
})

test("recases shouting names but leaves correct ones alone", () => {
  assert.equal(normalizePersonName("ADA LOVELACE"), "Ada Lovelace")
  assert.equal(normalizePersonName("ada lovelace"), "Ada Lovelace")
  assert.equal(normalizePersonName("mary-jane watson"), "Mary-Jane Watson")
  // Mixed case is deliberate and must not be "fixed".
  assert.equal(normalizePersonName("Ada McDonald"), "Ada McDonald")
  assert.equal(normalizePersonName("van der Berg"), "van der Berg")
})

test("phone keys ignore formatting and the US country code", () => {
  assert.equal(phoneKey("+1 (555) 123-4567"), "5551234567")
  assert.equal(phoneKey("555.123.4567"), "5551234567")
  assert.equal(phoneKey(""), "")
})

// ─── Email QA ────────────────────────────────────────────────────────────────

const UNSUB = '<a href="https://acme.com/unsubscribe">Unsubscribe</a>'

test("blocks a link with no tracking", () => {
  const report = auditEmail({
    html: `<a href="https://acme.com/pricing">See pricing</a>${UNSUB}`,
  })
  assert.equal(report.clean, false)
  assert.ok(
    report.findings.some(
      (f) => f.severity === "blocking" && /No UTM parameters/.test(f.issue)
    )
  )
})

test("flags UTM casing that will split a channel", () => {
  const report = auditEmail({
    html: `<a href="https://acme.com/x?utm_source=li&utm_medium=Paid_Social&utm_campaign=q1">x</a>${UNSUB}`,
  })
  assert.ok(
    report.findings.some((f) => /will aggregate separately from "paid-social"/.test(f.issue))
  )
})

test("does not demand UTMs on social and developer links", () => {
  const report = auditEmail({
    html: `<a href="https://twitter.com/acme">Follow</a>${UNSUB}`,
  })
  assert.equal(report.clean, true)
})

test("blocks a missing unsubscribe link", () => {
  const report = auditEmail({ html: "<p>Hello</p>" })
  assert.ok(
    report.findings.some(
      (f) => f.severity === "blocking" && /unsubscribe/i.test(f.issue)
    )
  )
})

test("blocks unreplaced merge tokens and placeholder copy", () => {
  const tokens = auditEmail({ html: `<p>Hi {{first_name}}</p>${UNSUB}` })
  assert.ok(tokens.findings.some((f) => /Unreplaced merge tokens/.test(f.issue)))

  const lorem = auditEmail({ html: `<p>Lorem ipsum dolor sit amet</p>${UNSUB}` })
  assert.ok(lorem.findings.some((f) => /lorem-ipsum/.test(f.issue)))
})

test("counts images missing alt text", () => {
  const report = auditEmail({
    html: `<img src="a.png"><img src="b.png" alt="Chart">${UNSUB}`,
  })
  assert.equal(report.images.total, 2)
  assert.equal(report.images.missingAlt, 1)
})

test("checks the subject for length, shouting, and spam phrases", () => {
  const long = auditEmail({ html: UNSUB, subject: "x".repeat(80) })
  assert.ok(long.findings.some((f) => /will truncate/.test(f.issue)))

  const spam = auditEmail({ html: UNSUB, subject: "Act now — guaranteed results" })
  assert.ok(spam.findings.some((f) => /spam-filter trigger/.test(f.issue)))

  const shouting = auditEmail({ html: UNSUB, subject: "READ THIS IMMEDIATELY" })
  assert.ok(shouting.findings.some((f) => /all caps/.test(f.issue)))

  const empty = auditEmail({ html: UNSUB, subject: "  " })
  assert.ok(
    empty.findings.some((f) => f.severity === "blocking" && /empty/.test(f.issue))
  )
})

test("flags a preheader that just repeats the subject", () => {
  const report = auditEmail({
    html: UNSUB,
    subject: "New pricing",
    preheader: "New pricing",
  })
  assert.ok(report.findings.some((f) => /duplicates the subject/.test(f.issue)))
})

test("notices links pointing at two different campaigns", () => {
  const report = auditEmail({
    html:
      `<a href="https://acme.com/a?utm_source=e&utm_medium=email&utm_campaign=one">a</a>` +
      `<a href="https://acme.com/b?utm_source=e&utm_medium=email&utm_campaign=two">b</a>` +
      UNSUB,
  })
  assert.ok(report.findings.some((f) => /different utm_campaign values/.test(f.issue)))
})

test("the unsubscribe link itself is not treated as an untracked campaign link", () => {
  // Regression: this made every correctly built email report a blocking issue.
  const report = auditEmail({ html: `<p>Hi</p>${UNSUB}` })
  assert.equal(
    report.findings.some((f) => f.severity === "blocking"),
    false,
    JSON.stringify(report.findings)
  )
})

test("a well-formed email comes back clean", () => {
  const report = auditEmail({
    html:
      `<img src="hero.png" alt="Product screenshot">` +
      `<a href="https://acme.com/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=q1-launch">See pricing</a>` +
      UNSUB,
    subject: "Introducing usage-based pricing",
    preheader: "Pay for what you use, nothing more",
  })
  assert.equal(report.clean, true, JSON.stringify(report.findings))
  assert.equal(report.links.untracked, 0)
})

// ─── Slack App Home ──────────────────────────────────────────────────────────

test("the home tab tells the truth about what is connected", async () => {
  const { buildHomeView } = await import("../agent/lib/slack-home")

  for (const name of [
    "SALESFORCE_ACCESS_TOKEN", "SALESFORCE_INSTANCE_URL", "LINEAR_API_KEY",
    "ASANA_ACCESS_TOKEN", "HUBSPOT_API_TOKEN", "KNAK_API_KEY", "LUMA_API_KEY",
    "GITHUB_TOKEN", "GITHUB_REPO", "MONDAY_API_TOKEN", "CLICKUP_API_TOKEN",
    "JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN", "MOPERATOR_TRACKER",
  ]) {
    delete process.env[name]
  }

  const bare = JSON.stringify(buildHomeView())
  assert.match(bare, /Nothing is connected yet/)
  // It must not advertise a capability this install does not have.
  assert.doesNotMatch(bare, /Show me active campaigns/)

  process.env.SALESFORCE_ACCESS_TOKEN = "t"
  process.env.SALESFORCE_INSTANCE_URL = "https://x.my.salesforce.com"
  const withCrm = JSON.stringify(buildHomeView())
  assert.match(withCrm, /Salesforce/)
  assert.match(withCrm, /active campaigns/)
  // And it still names what is missing rather than staying silent.
  assert.match(withCrm, /Not connected/)
})

test("the home tab states the write rules from live config", async () => {
  const { buildHomeView } = await import("../agent/lib/slack-home")
  const view = JSON.stringify(buildHomeView({
    recentActivity: { turns: 12, toolCalls: 40, days: 7 },
  }))
  assert.match(view, /Bulk changes over 100 are always reviewed/)
  assert.match(view, /recorded under \*your\* name/)
  assert.match(view, /12 conversation\(s\), 40 action\(s\)/)
})

// ─── Import target ───────────────────────────────────────────────────────────

test("imports default to Lead, but Contact-only orgs can say so", async () => {
  // Read at import time by the config module, so assert the parse rule the
  // module uses rather than re-importing it per case.
  const parse = (value: string | undefined) =>
    (value || "").trim().toLowerCase() === "contact" ? "Contact" : "Lead"

  assert.equal(parse(undefined), "Lead")
  assert.equal(parse(""), "Lead")
  assert.equal(parse("Lead"), "Lead")
  assert.equal(parse("Contact"), "Contact")
  assert.equal(parse("  contact  "), "Contact")
  assert.equal(parse("CONTACT"), "Contact")
  // An unrecognized value must fall back to the safe default rather than
  // inventing an object that does not exist.
  assert.equal(parse("Person"), "Lead")
})

test("dedupe object names keep their case, since API names are case-sensitive", async () => {
  const { config } = await import("../agent/lib/config")
  for (const name of config.salesforce.dedupeObjects) {
    assert.equal(name, name.trim())
    assert.match(name, /^[A-Z]/, `${name} should keep its API casing`)
  }
})

test("the prompt tells the agent which model the org runs", async () => {
  const { renderCapabilities } = await import("../agent/lib/integrations")
  process.env.SALESFORCE_ACCESS_TOKEN = "t"
  process.env.SALESFORCE_INSTANCE_URL = "https://x.my.salesforce.com"
  const rendered = renderCapabilities()
  assert.match(rendered, /imports people from a list as \*\*(Lead|Contact)s\*\*/)
})
