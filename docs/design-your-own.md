# Design your own with AI

[Adding integrations](adding-integrations.md) covers the mechanics — a client, a
tool file, a registry entry. This is about the bigger move: using an AI coding tool
to build capabilities your team specifically needs.

You do not have to be a developer. If you can describe the process, you can get it
built — and much of the time what you need is a markdown file, not code.

---

## The idea

mOperator ships with seven integrations and seven skills. The point is that yours
will be different. Every marketing ops team has a handful of processes nobody else
runs, and those are exactly the ones worth automating.

Things teams have built on top of this:

- **Campaign QA** — checks naming, UTMs, audience size, and opt-out filtering
  before anything sends
- **Weekly exec numbers** — the same five metrics from the same five fields, so
  nobody rebuilds the query every Monday
- **Lead routing** — looks up territory assignments and explains why a lead landed
  where it did
- **BI reporting** — pulls from the warehouse and posts a formatted digest
- **Deliverability watch** — bounce and complaint rates by domain, flagged before
  the next send

Note how few of those need a new API client. Most are a skill plus tools the agent
already has.

## How to build one

You do not need to write it from scratch. Use an AI coding tool and describe what
you want. This repo is set up to help it help you: `AGENTS.md` documents the
conventions, and `node_modules/eve/docs/` has the full framework reference on disk.

### Step 1: point it at the docs

Start with this, and be specific about the docs — otherwise it will guess at an
API from memory and you will spend the session correcting it.

```
I'm adding an integration to mOperator, an eve agent.

Before writing code, read:
- AGENTS.md (conventions for this repo)
- docs/adding-integrations.md (the template)
- agent/tools/salesforce.ts (a real example, including approval policies)
- node_modules/eve/docs/tools/overview.mdx (the framework API)

The integration should:
- [what it does, in plain English]
- [which API it talks to — paste the API docs]
- [which actions the agent should be able to take]

Follow the repo's pattern: a client in agent/lib/<name>/client.ts, one
dynamic tool file in agent/tools/<name>.ts gated on isConfigured(), and an
entry in agent/lib/integrations.ts.
```

### Step 2: be explicit about writes

This is the part an AI tool will get wrong if you do not say it. Tell it which
actions change state, and which policy each needs:

```
These actions modify data and need approval policies from agent/lib/approval.ts:
- create/update a record -> writeApproval()
- anything touching a list -> bulkApproval(input => input?.ids?.length ?? 0)
- delete -> deleteApproval()
- anything that emails or messages real people -> externalSendApproval()
- anything that spends money -> spendApproval() plus requireSpendApprover(ctx)
  at the top of execute
```

A tool with no `approval` runs unattended. On a CRM that is how you end up
explaining an unreviewed bulk update to your team.

### Step 3: test it

```bash
npm run agent:info    # did eve discover the tool?
npm run agent         # talk to it
```

`agent:info` first. If the tool is not listed, the file is in the wrong place or
the registry entry is missing, and the answer is in the diagnostics rather than in
the conversation.

Then ask for the thing the tool is for. If it fails, paste the error back — the
loop of describe, generate, test, fix is the whole workflow.

### Step 4: pin the behavior

Once it works, write an eval so it keeps working:

```
Add an eval under evals/ that sends a realistic request, asserts the run
succeeded, and asserts my new tool was called. Follow
evals/tracking/utm-conventions.eval.ts.
```

Then `npm run eval`. This is what tells you a prompt edit three weeks from now
broke your integration.

### Step 5: teach it the procedure

A tool gives the agent an ability. A **skill** gives it your team's way of using
that ability — and it is usually the higher-value half.

```
Add a skill at agent/skills/<name>.md with a `description` in the frontmatter
describing when to use it. Content: the steps our team follows for [process],
including the checks people forget.
```

The skill is where "how we actually run a send" belongs. Start by writing down
what you find yourself explaining to new hires.

## Two examples that shipped

Both of these started as custom integrations on teams using mOperator. Both are
now in the box — which is the best argument for building your own: the useful ones
graduate.

### List import, which became a skill and a sandbox

**The problem.** Importing contact lists from Slack meant download the CSV, clean
it in Excel, upload to Salesforce, wait, check for errors. Thirty minutes a list.

**What it needed** was not really a tool. The agent already had a filesystem and
Salesforce access; what it lacked was the *procedure* — normalize before comparing,
check against the CRM and not just within the file, never re-add an unsubscribed
address whatever the spreadsheet says.

That is `agent/skills/list-hygiene.md`. Read it before building your own version;
you may only need to change the checks.

### Data dictionary, which became the audience vocabulary

**The problem.** The agent wrote bad SOQL because `Account.MQL_Score__c` is not
guessable, and "segment" meant one specific custom field that no amount of schema
inspection would identify.

**What it became** is the audience vocabulary: a curated map from marketer-speak to
canonical field paths, editable at `/audience-vocab` without a deploy, injected
into the system prompt at session start. Crucially it also carries an `avoid` list
— "not `Segment__c`, that stopped syncing in 2024" — which is the part a schema
dump can never tell you.

If your dictionary lives in a spreadsheet, the integration worth building is a
sync into the vocabulary store, not a lookup tool.

## What makes a good integration

**One tool, one job.** `validate_import_list`, `import_contacts`,
`check_duplicates` — not one `do_everything`. The model picks the right tool when
each has a clear purpose, and a narrow tool is far easier to gate correctly.

**Never throw.** Return `{ success: false, error }` with the API's own message. A
thrown error is a failure the model cannot explain; a returned one is something it
can report or work around.

**Write the description for the model.** It is the only thing between the model and
the wrong tool. Say when to use it, what to call first, and what the usual mistake
is. Compare: `process_data` versus "Validate a contact list before import. Call
`describe_salesforce_object` first if you are unsure which fields are required."

**Return paths, not payloads.** If a tool can produce many rows, write them to
`/workspace` and return the path. The Slack channel attaches the file and the model
reasons about a summary instead of burning its context.

**Gate anything that changes state.** Reads need no policy. Everything else does.
See the table in [adding-integrations.md](adding-integrations.md).

**Ask whether it should be a skill instead.** If the agent already has the tools
and what is missing is knowing *how your team does it*, write a skill. It is a
markdown file, it costs nothing when not loaded, and it is the thing your ops team
can maintain without touching TypeScript.

## Separate services

Sometimes the capability belongs in its own service — it needs a database, it is
shared across several tools, or it is complex enough to deserve its own tests.

Three ways to connect one, cheapest first:

**1. It already speaks MCP.** Then it is a connection, not a client:

```ts
// agent/connections/my-service.ts
import { defineMcpClientConnection } from "eve/connections"
import { once } from "eve/tools/approval"

export default defineMcpClientConnection({
  url: "https://my-service.internal/mcp",
  description: "What it does, written for the model.",
  auth: { getToken: async () => ({ token: process.env.MY_SERVICE_TOKEN! }) },
  approval: once(),  // policies in agent/lib/approval.ts do NOT cover connections
})
```

**2. It has an OpenAPI document.** Same idea with `defineOpenAPIConnection` and a
`spec` URL — eve turns each operation into a tool.

**3. It is a plain HTTP API.** Then it is an ordinary integration: a client that
fetches, and a tool file. See [adding-integrations.md](adding-integrations.md).

```ts
// agent/lib/my-service/client.ts
export async function processData(input: string) {
  const response = await fetch(`${process.env.MY_SERVICE_URL}/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.MY_SERVICE_TOKEN}`,
    },
    body: JSON.stringify({ input }),
  })
  if (!response.ok) {
    throw new Error(`my-service ${response.status}: ${await response.text()}`)
  }
  return response.json()
}
```

The one thing to get right in all three cases: a connection's tools are not
covered by this repo's approval policies, because you did not author them. If any
of them can create, modify, delete, or send, set `approval` on the connection
itself.

---

## Getting help

- [Adding integrations](adding-integrations.md) — the mechanics and a template
- [Fork this](fork-this.md) — the wider customization path
- `AGENTS.md` — conventions, and the mistakes worth avoiding
- `agent/tools/salesforce.ts` — the most complete real example in the repo
- `node_modules/eve/docs/` — the framework reference, matching your installed version
- `npm run agent:info` — what the framework actually found on disk

The best additions come from real pain. If you do something by hand more than
twice, write it down as a skill first — often that is the entire fix.
