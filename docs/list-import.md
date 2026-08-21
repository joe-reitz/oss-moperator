# Importing a list

The flow behind *"here's the list from the conference — dedupe it against
Salesforce and add the new ones to the campaign."*

It is also the single most common way bad data gets into a system of record, so
the tools are deliberately staged: inspect, then dedupe, then import, then add to
the campaign. Each step reports numbers a human can check before the next one
runs.

---

## Setup

### 1. Salesforce

Nothing beyond the normal Salesforce connection —
see [Connect Salesforce](setup-salesforce.md). The account or user doing the
importing needs **Create** on Lead and Contact, and **Create** on CampaignMember.

### 2. Slack file access

The list arrives as an attachment, so the Slack app needs to read files:

- **OAuth & Permissions** → add the `files:read` scope
- Reinstall the app

Attachments land in the agent's workspace at `/workspace/attachments`. Add
`files:write` too if you want the agent to attach the cleaned files back to the
thread, which is worth having — it means the numbers it reports are reviewable.

### 3. Lead or Contact?

The one decision worth making before your first import.

```bash
MOPERATOR_IMPORT_OBJECT=Lead      # default
MOPERATOR_IMPORT_OBJECT=Contact   # for orgs that do not use Leads
```

**Lead** is the default because it is the classic Salesforce model and a Lead
stands alone — it needs no Account until someone converts it. If your team works
a queue of unconverted people, this is you.

**Contact** is right for the many orgs that never adopted Leads and run
everything as Contacts under Accounts. Set it and the agent stops proposing
Leads.

That choice has one real consequence, and it is why this is not just a label:

> A Contact wants an `AccountId`. One created without it is a *private* Contact,
> which most B2B reporting cannot see. So in a contact-only org, an import
> normally has to resolve the Account first — match existing ones by email domain
> or company name, create the missing ones, or accept private Contacts
> deliberately.

The agent will ask rather than guess. It knows which model your org runs, because
`MOPERATOR_IMPORT_OBJECT` is rendered into its instructions.

You can also override per import — *"import these as Contacts"* — without
changing configuration. The setting is the default, not a restriction.

### Which objects get deduped against

```bash
MOPERATOR_DEDUPE_OBJECTS=Contact,Lead   # default, in priority order
```

Both by default regardless of the import target, because orgs migrate and legacy
Leads outlive the decision to stop using them. First match wins, so put the
object that "already exists" most authoritatively first.

Narrow it only if you are certain — each object costs one chunked query pass per
import.

### 4. Write identity

Imports create records, so they follow the same identity rule as every other
write: the change is recorded under **the person who asked**, and if it cannot
be, it does not happen. The first import will pause for a one-time Salesforce
sign-in. See [Salesforce write identity](sfdc-per-user-oauth.md).

Scheduled runs cannot import, by design — there is nobody to attribute the
records to.

### 5. Check it before you need it

```bash
npm run agent:doctor
```

It confirms Salesforce is reachable and that per-user identity has what it needs.
An import that fails at the last step because `MOPERATOR_TOKEN_ENCRYPTION_KEY` is
unset is a bad time to find out.

### Trying it without a Salesforce org

```bash
MOPERATOR_MOCK=true npm run agent
```

Gives you a small in-memory org — including one deliberately opted-out contact,
so the suppression step has something to catch.

---

## Required fields

This is where imports actually fail. Salesforce's requirements are not obvious,
and the error it returns names the field but not the fix.

Which table applies depends on `MOPERATOR_IMPORT_OBJECT` above.

### Lead — the default import target

| Field | Required | Notes |
| --- | --- | --- |
| `LastName` | **Yes** | Salesforce rejects the row without it. A single "Full Name" column has to be split first. |
| `Company` | **Yes** | The one people forget. Every Lead needs a company, and a blank one fails the row. Use `defaults` to set something like "Unknown" if the file genuinely lacks it. |
| `Email` | No, but | Not required by Salesforce. Required in practice — without it the record cannot be deduped, mailed, or matched later. |
| `FirstName` | No | |
| `LeadSource` | No | Set it via `defaults`. Skipping it is why attribution reports have a large "unknown" bucket. |
| `Status` | No | Defaults to your org's default lead status. |

### Contact — the target for contact-only orgs

| Field | Required | Notes |
| --- | --- | --- |
| `LastName` | **Yes** | |
| `AccountId` | No, but | Technically optional — a Contact without one is a *private* Contact, which most B2B reporting cannot see. In practice this is the field that decides whether the import was useful. |
| `Email` | No, but | Same as Lead: not Salesforce-required, required in practice. |

Note what is **not** here: `Company`. Contacts get their company through
`AccountId`, which is the whole difference between the two models. A Lead carries
its company as text and stands alone; a Contact points at a real Account record.

**Resolving the Account** is therefore the work. Three defensible approaches:

1. **Match by email domain.** Query Accounts for the domains in the file, map the
   matches, and report the misses. Fastest, and wrong for anyone using a personal
   address — which is why the free-mail count from `inspect_list` matters.
2. **Match by company name**, using `normalize_list` to produce a comparison key
   first so "Acme, Inc." and "Acme Inc" match. Better coverage, more false
   positives.
3. **Import as private Contacts deliberately**, and let a downstream matching
   process attach them. Legitimate, but decide it rather than discovering it.

Ask for whichever you want; the agent will not pick for you.

### CampaignMember — adding them to the campaign

| Field | Required | Notes |
| --- | --- | --- |
| `CampaignId` | **Yes** | Starts with `701`. |
| `ContactId` **or** `LeadId` | **Yes** | Exactly one, never both. The agent routes this for you from the id prefix — `003` is a Contact, `00Q` is a Lead — so a mixed list works. |
| `Status` | No | Optional, but **it must be one of that campaign's configured member statuses**. They are per-campaign. A value you invented fails every row. |

To see the valid statuses for a campaign:

```sql
SELECT Label, IsDefault FROM CampaignMemberStatus WHERE CampaignId = '701...'
```

Omit `status` and Salesforce uses the campaign's default.

### Your org's own required fields

Everything above is standard Salesforce. Your org almost certainly adds more —
a required `Country__c`, a validation rule demanding a region, a required picklist
on Lead. Those are invisible from here.

Ask the agent to check before importing:

> Describe the Lead object and tell me which fields are required

It calls `describe_salesforce_object`, which reports `required: true` per field.
Doing that first turns "600 rows failed" into "add a Region and we're fine."

### Opt-in and consent

Not required to create a record, so it is not blocking. But two things matter:

- **The dedupe step already checks suppression.** It looks at
  `HasOptedOutOfEmail` and `IsEmailBounced` where the object has them, and puts
  those people in a separate `suppressed` file. They must never go onto a sending
  list, whatever the spreadsheet says — the file usually predates the opt-out.
- **A consent field the file carries is not the same as consent in your CRM.** If
  the list has a "marketing opt-in" column, map it to whatever field your org
  actually uses for consent, via `field_map`. Do not assume importing implies
  permission to email.

If your org has a required consent field, `describe_salesforce_object` will show
it and the import will fail without it — which is the correct outcome.

---

## The flow

### 1. Inspect

> Here's the list from the conference *(attach the CSV)*. What's in it?

`inspect_list` reports the row count, the columns, which column holds emails, and
the counts that decide what happens next: malformed emails, duplicates within the
file, role addresses (`info@`, `sales@`), free-mail domains.

Nothing is fixed silently. A list with 40 bad rows is a conversation.

### 2. Normalize (optional)

> Normalize the countries and job titles first

`normalize_list` maps country spellings to ISO codes, job titles to seniority
bands, and company names to a comparison key. It **adds columns** rather than
overwriting, so the originals survive.

Its *unrecognized* counts are the useful output — they are what your picklists are
missing.

### 3. Dedupe against Salesforce

> Dedupe it against Salesforce

`dedupe_list_against_salesforce` queries Contact and Lead in chunks (SOQL cannot
take a thousand emails in one `IN` clause) and writes three files:

| File | What it is |
| --- | --- |
| `…-new.csv` | Not in Salesforce. The import candidates. |
| `…-existing.csv` | Already known, annotated with the object and record id. |
| `…-suppressed.csv` | Already opted out or bounced. Do not mail these. |

A Contact outranks a Lead when someone is both.

### 4. Import the new ones

> Import the new ones, source Conference

The agent uses the configured target. Say *"as Contacts"* or *"as Leads"* to
override for one import.

```
create_salesforce_records
  object_name: "Lead"
  csv_path:    "/workspace/leads-new.csv"
  field_map:   { "Work Email": "Email", "Surname": "LastName" }
  defaults:    { "LeadSource": "Conference", "Company": "Unknown" }
```

`field_map` renames CSV columns to Salesforce API names. `defaults` applies to
every row — the right place for `LeadSource`, and for a `Company` fallback.
Columns starting with `_` are dropped, so the annotations the dedupe step added do
not leak into the CRM.

Partial success is normal and reported: good rows land, bad rows come back with
reasons. Do not re-run the whole file to retry a handful.

### 5. Add them to the campaign

> Add them all to campaign 701xx000000ABCD with status Sent

`add_campaign_members` takes Contact ids, Lead ids, or a mix. After a dedupe the
mix is the normal case — the already-known people are Contacts, the ones you just
created are Leads.

---

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Records per insert call | 200 | Salesforce's collections API. The tool chunks; you do not. |
| Emails per dedupe query | 200 | Keeps the SOQL statement inside its length limit. |
| Rows per tool call | `MOPERATOR_BULK_MAX` (1,500) | Refused above this. Split the file. |
| Approval threshold | `MOPERATOR_BULK_APPROVAL_THRESHOLD` (100) | Above this, always reviewed — even for approvers. |

Splitting a file to get under the approval threshold does not work: the cap is per
call and the agent is told why.

---

## When it goes wrong

- **"Required fields are missing: [Company]"** — the classic, and Lead-only. Add
  `defaults: { "Company": "Unknown" }`, or map a column to it. If you see this
  while importing Contacts, something is targeting Lead that should not be.
- **"Required fields are missing: [LastName]"** — the file has one "Name" column.
  Split it before importing.
- **Every row failed with the same message** — that is a schema or validation
  problem, not a data problem. Run `describe_salesforce_object` and fix it once.
- **"Cannot specify both ContactId and LeadId"** — should not happen; the agent
  routes by id prefix. Report it.
- **A campaign status error on every row** — the status is not configured on that
  campaign. Query `CampaignMemberStatus`.
- **Duplicates got created anyway** — Salesforce duplicate rules run on the UI,
  not necessarily on the API. The dedupe step is what prevents this, so do not
  skip it. Also check `MOPERATOR_DEDUPE_OBJECTS`: if you narrowed it and the
  person existed as the object you excluded, they were genuinely new as far as
  the check could tell.
- **Contacts imported but reports cannot see them** — they were created without
  an `AccountId`, so they are private Contacts. Resolve the Account and update
  them; see the Contact table above.
- **The file will not read** — the agent looks in `/workspace/attachments`. If it
  cannot find it, the Slack app is probably missing `files:read`.

---

## What is not automated

**Lead assignment rules do not fire** on an API insert unless explicitly
triggered. Imported Leads land with whatever owner the API defaults to. If your
org routes leads by territory, run assignment afterwards or set `OwnerId` via
`defaults`.

**Nothing is emailed.** Importing puts people in the CRM. Sending is a separate,
separately approved action.

**Person Accounts** are not handled specially. If your org uses them, check what
a Contact insert does before running a large import.

---

## Further reading

- [Connect Salesforce](setup-salesforce.md)
- [Salesforce write identity](sfdc-per-user-oauth.md) — why the first import asks you to sign in
- `agent/skills/list-hygiene.md` — the checklist the agent follows
