# Working on mOperator

Context for developers and AI assistants changing this codebase.

## What this is

mOperator is a marketing operations agent built on [eve](https://eve.dev),
Vercel's framework for durable backend agents. It runs in Slack and in a browser,
works against a company's own CRM and ad accounts, and is designed to be **forked
and customized** rather than configured.

That last point drives most of the design decisions here. When choosing between
two implementations, prefer the one a stranger can find and change.

**Read the framework docs before writing agent code.** They ship with the
installed version and match it exactly:

```
node_modules/eve/docs/README.md
```

Do not infer eve's API from memory or from this file. Check the bundled docs.

## Layout

```
agent/                    the agent — this is the product
├── agent.ts              model, reasoning, compaction, session limits
├── instructions/         system prompt (.md static, .ts per-session)
├── tools/                one file per integration, plus always-on tools
├── skills/               on-demand playbooks
├── channels/             slack.ts, eve.ts
├── subagents/            data-analyst (read-only)
├── schedules/            cron jobs -> Vercel Cron on deploy
├── hooks/                lifecycle observers
├── sandbox/              /workspace and its data tooling
└── lib/                  clients, config, approval policies, shared helpers

evals/                    scored checks (npm run eval)
src/app/                  Next.js: site, /chat, /console, /analytics, /audience-vocab
docs/                     also served at /docs/<slug>
```

`agent/lib/` is import-only. The Next.js app imports from it via the `@agent/*`
alias — that is deliberate, so the SOQL console and the agent share one Salesforce
client and one SOQL validator rather than drifting.

## The loop

```bash
npm run agent         # terminal chat, hot reload
npm run agent:info    # what did eve discover? run this first when confused
npm run dev           # full app (boots the agent too, via withEve)
npm run typecheck
npm run eval
```

`npm run agent:info` reports discovery errors with file paths. Reach for it before
reading logs.

## Conventions

**Tools are snake_case**, matching the built-ins: `query_salesforce`,
`build_tracking_url`. Parameters too: `object_name`, not `objectName`.

**Tools never throw.** Return `{ success: false, error }` and include the API's
own message. A thrown error is a failed call the model cannot explain; a returned
one is something it can report or route around.

**Two tool shapes, for two jobs:**

- *Static* — one file, one default-exported `defineTool`. For always-available
  tools with no credentials.
- *Dynamic* — `defineDynamic` returning a map, gated on `isConfigured(id)`. For
  integrations. Returning `null` when unconfigured is what keeps the model from
  promising work this install cannot do.

**In dynamic files, `execute` must be written inline.** `execute: someFunction`
works on the first step and then breaks when the runtime replays it. This is a
real constraint of the closure-reconstruction transform, not a style preference.

**Descriptions are written for the model.** Say when to use the tool, what to call
first, and what the common mistake is. `query_salesforce` tells the model to
describe the object first because a guessed field name is the top cause of
failure. That sentence prevents more errors than any code in the file.

**Return paths, not payloads.** Anything that can produce many rows writes to
`/workspace` via `writeCsvToWorkspace` and returns a path. The Slack channel
attaches the file; the model reasons about a summary.

**Never add a write tool without an approval policy.** The policies are in
`agent/lib/approval.ts`:

| Policy | For |
| --- | --- |
| none | reads only |
| `writeApproval()` | single-record writes |
| `bulkApproval(countFn)` | anything touching a list |
| `deleteApproval()` | deletions — never from a schedule |
| `externalSendApproval()` | anything reaching real people |
| `spendApproval()` + `requireSpendApprover(ctx)` | anything moving money — both halves |

Omitting `approval` means the tool runs unattended.

## Things that are easy to get wrong

**Approvals are durable pauses, not records.** Do not add a store, a TTL, or a
reminder job. The turn suspends and resumes; that is the whole mechanism.

**Do not tell the model a write is "pending approval".** The old code returned a
`pending_approval` sentinel and the agent ended the conversation mid-task. The
turn now genuinely pauses and then completes.

**Slack takes markdown.** The channel converts to mrkdwn. Do not reintroduce
`markdownToSlack` or instructions about `*bold*` — write normal markdown, tables
and headings included.

**Do not hand-write the integration list into the prompt.**
`agent/instructions/20-capabilities.ts` renders the live set from
`agent/lib/integrations.ts`. Adding an integration in one place updates the prompt.

**Subagents inherit nothing.** A subagent gets only what its own directory
declares — that is what makes `data-analyst` genuinely read-only, and why it
declares its own sandbox. Adding a tool to `agent/tools/` does not give it to a
subagent, which is usually what you want.

**Identity is resolved once, at the channel.** `authWithEmail` in the Slack
channel and the auth walk in `agent/channels/eve.ts` stamp the caller's email onto
the session. Everything downstream reads that attribute, so approval policies stay
pure and make no network calls. Do not look up identity inside a tool.

**A new channel does not inherit approver gating.** If you add Teams or Discord,
copy `onInputResponse` from `agent/channels/slack.ts`. Without it, anyone who can
see an approval prompt on that platform can answer it.

**Connection tools are not covered by this repo's policies.** Policies apply to
`agent/tools/`. A connection brings in tools we did not author — gate the whole
connection with `once()` or `always()`.

## Where to make a change

| Change | File |
| --- | --- |
| Approver lists, limits, naming and UTM conventions | `agent/lib/config.ts` |
| How the agent talks or what it refuses | `agent/instructions/` |
| A procedure the agent should follow | `agent/skills/` |
| A new integration | `agent/lib/<name>/client.ts` + `agent/tools/<name>.ts` + a registry entry |
| Which writes need a human | `agent/lib/approval.ts` |
| Who may talk to it or approve | `agent/channels/` |
| Model, reasoning, compaction, limits | `agent/agent.ts` |
| What is installed in the sandbox | `agent/sandbox/sandbox.ts` |

## Design principles

**Composability over features.** A new tool should combine with the existing ones.
`build_tracking_url` is useful because the campaign-launch skill can call it after
creating a Salesforce campaign.

**Make the safe path the easy path.** The reason bulk limits live in an approval
policy rather than a prompt instruction is that a policy cannot be argued with.

**A fork should be legible.** Someone cloning this needs to find where a behavior
comes from in under a minute. That is worth more than clever indirection.

**Prefer deleting to configuring.** If a feature needs a flag to turn off, ask
whether it should be a file someone deletes instead.
