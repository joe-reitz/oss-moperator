/**
 * A fake Salesforce org, for running this repo with no credentials.
 *
 * The problem it solves is contribution, not testing in anger: without it a
 * stranger who clones this cannot exercise a single CRM tool, so they cannot
 * tell whether a change works. `MOPERATOR_MOCK_SALESFORCE=true` gives them a
 * small in-memory org that responds to queries, describes, and writes.
 *
 * Deliberately scoped to Salesforce. It is the integration the skills, the
 * evals, and the list-import flow all key on, so it is the one that unblocks
 * the most. A half-hearted mock across eight integrations that silently
 * returned nothing for six of them would be worse than one that is honest
 * about its edges.
 *
 * The SOQL support is a subset — FROM, a single `=` or `IN` predicate, LIMIT,
 * and COUNT(). That is enough for the evals and for poking around, and every
 * response carries a `_mock` marker so nothing here can be mistaken for real
 * data.
 */

import { randomUUID } from "crypto"

export function mockEnabled(): boolean {
  return (
    process.env.MOPERATOR_MOCK_SALESFORCE === "true" ||
    process.env.MOPERATOR_MOCK === "true"
  )
}

type Row = Record<string, unknown>

/**
 * The seed org. Small on purpose — big enough to exercise joins, campaign
 * membership, and an opted-out contact that list hygiene must catch, small
 * enough to read in one screen.
 */
function seed(): Record<string, Row[]> {
  return {
    Account: [
      { Id: "001MOCK00000001", Name: "Acme Corp", Industry: "Technology", NumberOfEmployees: 1200, BillingCountry: "US" },
      { Id: "001MOCK00000002", Name: "Globex", Industry: "Manufacturing", NumberOfEmployees: 340, BillingCountry: "GB" },
      { Id: "001MOCK00000003", Name: "Initech", Industry: "Technology", NumberOfEmployees: 85, BillingCountry: "US" },
    ],
    Contact: [
      { Id: "003MOCK00000001", FirstName: "Ada", LastName: "Okonkwo", Email: "ada@acme.example", Title: "VP of Marketing", AccountId: "001MOCK00000001", HasOptedOutOfEmail: false },
      { Id: "003MOCK00000002", FirstName: "Bo", LastName: "Lindqvist", Email: "bo@acme.example", Title: "Marketing Operations Manager", AccountId: "001MOCK00000001", HasOptedOutOfEmail: false },
      // Opted out on purpose: the list-hygiene flow must never re-add this one.
      { Id: "003MOCK00000003", FirstName: "Cleo", LastName: "Marchetti", Email: "cleo@globex.example", Title: "CMO", AccountId: "001MOCK00000002", HasOptedOutOfEmail: true },
    ],
    Lead: [
      { Id: "00QMOCK00000001", FirstName: "Dev", LastName: "Patel", Email: "dev@initech.example", Company: "Initech", Status: "Open - Not Contacted", LeadSource: "Webinar", HasOptedOutOfEmail: false },
      { Id: "00QMOCK00000002", FirstName: "Emi", LastName: "Tanaka", Email: "emi@newco.example", Company: "NewCo", Status: "Working - Contacted", LeadSource: "Conference", HasOptedOutOfEmail: false },
    ],
    Campaign: [
      { Id: "701MOCK00000001", Name: "NAM-FY26Q1-webinar-observability-launch", Type: "Webinar", Status: "In Progress", IsActive: true, StartDate: "2026-01-15", NumberOfLeads: 42 },
      { Id: "701MOCK00000002", Name: "EMEA-FY26Q1-event-summit", Type: "Conference", Status: "Planned", IsActive: true, StartDate: "2026-03-02", NumberOfLeads: 0 },
      { Id: "701MOCK00000003", Name: "q1 newsletter", Type: "Email", Status: "Completed", IsActive: false, StartDate: "2025-11-01", NumberOfLeads: 210 },
    ],
    CampaignMember: [
      { Id: "00vMOCK00000001", CampaignId: "701MOCK00000001", ContactId: "003MOCK00000001", Status: "Responded" },
      { Id: "00vMOCK00000002", CampaignId: "701MOCK00000001", ContactId: "003MOCK00000002", Status: "Sent" },
    ],
    Opportunity: [
      { Id: "006MOCK00000001", Name: "Acme — Platform", AccountId: "001MOCK00000001", StageName: "Proposal", Amount: 60000, CloseDate: "2026-03-31" },
    ],
  }
}

/** Mutations persist for the life of the process, so a write is observable. */
let org: Record<string, Row[]> | null = null

function data(): Record<string, Row[]> {
  if (!org) org = seed()
  return org
}

/** Reset between eval cases so one test cannot leak into the next. */
export function resetMockOrg(): void {
  org = null
}

function mockId(objectName: string): string {
  const prefix =
    { Account: "001", Contact: "003", Lead: "00Q", Campaign: "701", CampaignMember: "00v", Opportunity: "006" }[
      objectName
    ] ?? "a0X"
  return `${prefix}MOCK${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`
}

// ─── A deliberately small SOQL subset ────────────────────────────────────────

interface ParsedSoql {
  object: string
  fields: string[]
  isCount: boolean
  where?: { field: string; op: "=" | "IN"; values: string[] }
  limit?: number
}

function parseSoql(soql: string): ParsedSoql | null {
  const flat = soql.replace(/\s+/g, " ").trim()
  const from = flat.match(/\bFROM\s+([A-Za-z0-9_]+)/i)
  if (!from) return null

  const select = flat.match(/^SELECT\s+(.+?)\s+FROM\b/i)
  const rawFields = select?.[1] ?? "Id"
  const isCount = /^COUNT\s*\(\s*\)?/i.test(rawFields.trim())

  const equals = flat.match(/\bWHERE\s+([A-Za-z0-9_.]+)\s*=\s*'([^']*)'/i)
  const inList = flat.match(/\bWHERE\s+([A-Za-z0-9_.]+)\s+IN\s*\(([^)]*)\)/i)
  const limit = flat.match(/\bLIMIT\s+(\d+)/i)

  return {
    object: from[1],
    fields: isCount
      ? ["Id"]
      : rawFields.split(",").map((field) => field.trim().split(/\s+/)[0]),
    isCount,
    where: inList
      ? {
          field: inList[1],
          op: "IN",
          values: inList[2]
            .split(",")
            .map((value) => value.trim().replace(/^'|'$/g, "").toLowerCase()),
        }
      : equals
        ? { field: equals[1], op: "=", values: [equals[2].toLowerCase()] }
        : undefined,
    limit: limit ? Number(limit[1]) : undefined,
  }
}

export function mockQuery(soql: string): Row[] {
  const parsed = parseSoql(soql)
  if (!parsed) return []

  const table = data()[parsed.object]
  if (!table) {
    throw new Error(
      `Mock Salesforce has no ${parsed.object} object. Available: ${Object.keys(data()).join(", ")}. ` +
        "Add it to agent/lib/salesforce/mock.ts if you need it."
    )
  }

  let rows = table
  if (parsed.where) {
    // Only top-level fields are filterable; a relationship path is ignored
    // rather than silently returning nothing.
    const field = parsed.where.field.split(".")[0]
    rows = rows.filter((row) => {
      const value = String(row[field] ?? "").toLowerCase()
      return parsed.where!.values.includes(value)
    })
  }
  if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit)

  if (parsed.isCount) {
    return rows.map(() => ({}))
  }

  // Project the requested fields, resolving a single relationship hop so
  // Account.Name works — the most common traversal by far.
  return rows.map((row) => {
    const out: Row = { attributes: { type: parsed.object }, _mock: true }
    const wantsAll = parsed.fields.some((field) => field === "*" || /^FIELDS/i.test(field))
    const fields = wantsAll ? Object.keys(row) : parsed.fields

    for (const field of fields) {
      if (field.includes(".")) {
        const [relation, target] = field.split(".")
        const key = relation === "Account" ? "AccountId" : `${relation}Id`
        const parent = (data()[relation] ?? []).find((entry) => entry.Id === row[key])
        out[relation] = parent ? { [target]: parent[target] } : null
        continue
      }
      out[field] = row[field] ?? null
    }
    if (!out.Id) out.Id = row.Id
    return out
  })
}

export function mockDescribe(objectName: string): {
  name: string
  label: string
  fields: Array<{ name: string; label: string; type: string; nillable: boolean; updateable: boolean }>
} {
  const table = data()[objectName]
  if (!table) {
    throw new Error(
      `Mock Salesforce has no ${objectName} object. Available: ${Object.keys(data()).join(", ")}.`
    )
  }
  const sample = table[0] ?? {}
  return {
    name: objectName,
    label: objectName,
    fields: Object.entries(sample).map(([name, value]) => ({
      name,
      label: name.replace(/([a-z])([A-Z])/g, "$1 $2"),
      type:
        typeof value === "number" ? "double" : typeof value === "boolean" ? "boolean" : "string",
      nillable: name !== "Id",
      updateable: name !== "Id",
    })),
  }
}

export function mockDescribeGlobal(): {
  sobjects: Array<{ name: string; label: string; custom: boolean; queryable: boolean }>
} {
  return {
    sobjects: Object.keys(data()).map((name) => ({
      name,
      label: name,
      custom: name.endsWith("__c"),
      queryable: true,
    })),
  }
}

export function mockCreate(objectName: string, record: Row): string {
  const table = data()[objectName] ?? (data()[objectName] = [])
  const id = mockId(objectName)
  table.push({ ...record, Id: id })
  return id
}

export function mockUpdate(objectName: string, id: string, changes: Row): void {
  const row = (data()[objectName] ?? []).find((entry) => entry.Id === id)
  if (!row) throw new Error(`Mock Salesforce has no ${objectName} with Id ${id}`)
  Object.assign(row, changes)
}

export function mockDelete(objectName: string, id: string): void {
  const table = data()[objectName] ?? []
  const index = table.findIndex((entry) => entry.Id === id)
  if (index < 0) throw new Error(`Mock Salesforce has no ${objectName} with Id ${id}`)
  table.splice(index, 1)
}
