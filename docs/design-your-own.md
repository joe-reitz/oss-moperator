# Design Your Own Integrations with AI

The existing [Adding Integrations](adding-integrations.md) guide covers the technical structure — three files, register, done. This guide is about the bigger picture: **using AI coding tools to design and build entirely new apps** that plug into mOperator.

You don't need to be a developer. If you can describe what you want, you can build it.

---

## The Idea

mOperator ships with Salesforce, Linear, and GitHub integrations. But the real power is building your own. Think of each integration as a small app that teaches mOperator a new skill.

Some examples from real marketing ops teams:

- **List Import Agent** — Upload a CSV to Slack, mOperator validates emails, dedupes against your CRM, and imports clean contacts
- **Data Dictionary** — mOperator understands your field mappings, lifecycle stages, and scoring models so it writes better SOQL
- **Campaign QA Bot** — Checks naming conventions, UTM parameters, and audience sizing before you hit send
- **Reporting Agent** — Pulls data from your BI tool and posts formatted weekly reports to Slack
- **Lead Routing Helper** — Looks up territory assignments and suggests routing rules based on your current data

None of these exist out of the box. They're custom to your team's workflow. That's the point.

---

## How to Build One (The Vibecoding Approach)

You don't need to write code from scratch. Use an AI coding tool — Claude, Cursor, GitHub Copilot, whatever you prefer — and describe what you want.

### Step 1: Describe the Integration

Start with a clear prompt to your AI coding tool. Here's a template:

```
I'm building an integration for mOperator (a Next.js app using the Vercel AI SDK).

The integration should:
- [What it does in plain English]
- [What external API or data source it connects to]
- [What actions the AI agent should be able to take]

The integration needs three files:
1. client.ts — handles API calls to [service]
2. tools.ts — defines AI SDK tools using the tool() function from 'ai' with zod schemas
3. index.ts — exports the integration manifest (name, description, capabilities, isConfigured)

Here's an example of an existing integration for reference:
[paste the weather example from adding-integrations.md]
```

### Step 2: Give It Context

The more context you give, the better the result. Share:

- The API documentation for whatever service you're connecting to
- Your `.env.example` file (so it knows the pattern for env vars)
- The `src/lib/integrations/types.ts` file (so it knows the Integration interface)
- An existing integration folder (like `src/lib/integrations/github/`) as a reference

### Step 3: Iterate

Your first version won't be perfect. That's fine. Test it:

```bash
npm run dev
npm run cli
```

Ask mOperator to use the new tool. If it doesn't work, paste the error back into your AI coding tool and ask it to fix it. This loop — describe → generate → test → fix — is how vibecoding works.

### Step 4: Register It

Once the three files work, register the integration in `src/lib/integrations/index.ts`:

```typescript
import { myIntegration } from './myservice'

const ALL_INTEGRATIONS: Integration[] = [
  // existing integrations...
  myIntegration,
]
```

Set the env vars, restart the app, and you're live.

---

## Real Example: List Import Agent

Here's how a team built a list import agent using this approach.

### The Problem

Marketing ops needed to import contact lists into Salesforce from Slack. The old process: download CSV → open in Excel → clean it up → upload to Salesforce → wait → check for errors. Took 30 minutes per list.

### The Prompt

```
Build a mOperator integration called "list-import" that:

1. Accepts a CSV file uploaded to Slack (mOperator already handles file downloads)
2. Parses the CSV and validates:
   - Email format is valid
   - Required fields (FirstName, LastName, Email) are present
   - No duplicate emails in the file
3. Checks each email against Salesforce to find existing contacts
4. Returns a summary: "X new contacts, Y already exist, Z have errors"
5. If the user confirms, creates the new contacts in Salesforce

The client.ts should:
- Parse CSV content into records
- Validate email format with a regex
- Check for required fields
- Dedupe by email

The tools.ts should have two tools:
- validateImportList: takes CSV content, returns validation summary
- executeImport: takes validated records, creates them in Salesforce

Use the existing Salesforce client for creating records.
```

### The Result

The AI coding tool generated the three files. After two rounds of fixes (a CSV parsing edge case and a Salesforce field mapping issue), it worked. The team went from 30 minutes per import to 2 minutes — upload the CSV, confirm, done.

---

## Real Example: Data Dictionary

### The Problem

mOperator kept writing bad SOQL queries because it didn't understand custom fields. `Account.MQL_Score__c` isn't obvious.

### The Prompt

```
Build a mOperator integration called "data-dictionary" that:

1. Reads a CSV from a URL (our internal data dictionary spreadsheet)
2. The CSV has columns: Object, API_Name, Label, Description, Type
3. Provides a tool that the AI can call to look up field definitions
4. The tool should support searching by object name, field label, or description

This is read-only — no writes needed. The CSV URL comes from an env var:
DATA_DICTIONARY_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv
```

### The Result

Now when someone asks "show me accounts with high MQL scores," mOperator looks up the data dictionary, finds `MQL_Score__c`, and writes the correct SOQL. The team maintains the dictionary in Google Sheets and mOperator always has the latest version.

---

## Tips for Good Integrations

### Keep tools focused
Each tool should do one thing. Instead of one giant `doEverything` tool, have `validateList`, `importContacts`, `checkDuplicates`. The AI model is better at choosing the right tool when each one has a clear purpose.

### Return structured data
Always return `{ success: true, data: ... }` or `{ success: false, error: "..." }`. This helps the AI model understand what happened and explain it to the user.

### Handle errors gracefully
If an API call fails, don't crash — return the error message. The AI will explain it to the user in plain English.

### Use descriptive names
Tool names and descriptions matter. The AI model reads them to decide which tool to use. `validateEmailList` is better than `processData`.

### Test with the CLI first
`npm run cli` is faster than testing through Slack. Get the tool working locally before deploying.

---

## Standalone Apps That Connect to mOperator

You can also build completely separate apps that mOperator connects to via API. This is useful when:

- The integration is complex enough to be its own service
- You want to share it across multiple bots or tools
- The integration needs its own database or state

The pattern:

1. Build a standalone API (could be another Next.js app, a Python service, whatever)
2. Deploy it somewhere (Vercel, Railway, your own server)
3. Create a mOperator integration that calls your API

Your integration's `client.ts` just makes HTTP calls to your standalone app:

```typescript
const API_URL = process.env.MY_APP_API_URL

export async function processData(input: string): Promise<Result> {
  const response = await fetch(`${API_URL}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  })
  return response.json()
}
```

This way your custom app can be as complex as it needs to be, and mOperator just knows how to talk to it.

---

## Getting Help

- Check the [Adding Integrations](adding-integrations.md) guide for the technical structure
- Look at existing integrations in `src/lib/integrations/` for reference
- Use AI coding tools to generate the boilerplate — focus your energy on describing what you need
- Test early and often with `npm run cli`

The best integrations come from real pain points. If you find yourself doing something manually more than twice, it's probably a good candidate for a mOperator integration.
