# Architecture

mOperator is an [eve](https://eve.dev) agent mounted into a Next.js app. One
repository, one Vercel project, two things running in it: the web app and the
agent runtime.

```
Slack (@mOperator)          Browser (/chat)         Cron (schedules)
        │                          │                       │
        ▼                          ▼                       ▼
 /eve/v1/slack            /eve/v1/session          agent/schedules/*
        │                          │                       │
        └──────────────┬───────────┴───────────────────────┘
                       ▼
                 the agent runtime
                       │
   ┌───────────────────┼───────────────────┬──────────────────┐
   ▼                   ▼                   ▼                  ▼
tools/              skills/            subagents/         sandbox
(env-gated)      (load on demand)   (data-analyst)    (/workspace + pandas)
   │
   ▼
lib/<service>/client.ts → Salesforce, HubSpot, Marketo, Google Ads, Linear, GitHub, Luma
```

The Next.js app serves the marketing site, the docs, `/chat`, `/console`,
`/analytics`, and `/audience-vocab`. `withEve()` in `next.config.ts` mounts the
agent's routes on the same origin, which is why the browser chat needs no CORS
config and no agent URL.

---

## The filesystem is the configuration

There is no registry, no plugin manifest, no wiring file. eve walks `agent/` and
the directory a file sits in determines what it is.

| Path | What it becomes |
| --- | --- |
| `agent/agent.ts` | Model, reasoning effort, compaction, session limits |
| `agent/instructions/` | The system prompt. `.md` is static, `.ts` resolves per session |
| `agent/tools/<name>.ts` | Tools. Filename is the name the model sees |
| `agent/skills/<name>.md` | Playbooks loaded on demand |
| `agent/channels/<name>.ts` | Entry points — Slack, HTTP |
| `agent/subagents/<name>/` | A specialist with its own tools and prompt |
| `agent/schedules/<name>.ts` | Cron jobs. Become Vercel Cron on deploy |
| `agent/hooks/<name>.ts` | Lifecycle observers |
| `agent/sandbox/sandbox.ts` | The workspace and what is installed in it |
| `agent/lib/` | Shared code. Import-only, never mounted anywhere |
| `evals/` | Scored checks, run with `npm run eval` |

`npm run agent:info` prints what was actually discovered. It is the fastest way to
find out why a file is not taking effect.

## Turns, steps, and durability

A **turn** is one inbound message and everything the agent does in response. It
runs as a sequence of durable steps on Vercel Workflow: each completed step is
journaled, so a crash, a redeploy, or a days-long pause resumes from the last
committed step rather than starting over.

This is the property everything else in the design leans on:

- An approval can wait indefinitely. Nothing is held in memory, so a deploy
  mid-approval is a non-event.
- A step that completed never re-runs — the recorded result is replayed. A step
  interrupted mid-execution does re-run, which is why anything non-idempotent
  (a send, a delete) sits behind an approval.
- A Salesforce sign-in can happen inline: the turn parks on the challenge and
  picks back up after the callback.

## How tools appear

Two shapes in `agent/tools/`, for two different jobs.

**Static** — one file, one tool, always available. `build_tracking_url`,
`parse_tracking_url`, `check_campaign_name`, plus the framework's `glob`, `grep`,
and `sleep`. No credentials, so no reason to hide them.

**Dynamic** — one file per integration, resolved at session start:

```ts
export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("salesforce")) return null
      return { query_salesforce: defineTool({ ... }), /* ... */ }
    },
  },
})
```

That `return null` is the whole reason this repo can ship seven integrations
without confusing the model. An install with no Marketo has no Marketo tools, so
the agent cannot offer a Marketo operation and then fail. The same
`isConfigured()` call drives the system prompt through
`agent/instructions/20-capabilities.ts`, so tools and prompt cannot drift.

## Where the safety lives

Three layers, each doing something the others cannot.

**1. Approval policies** — `agent/lib/approval.ts`. Pure functions that read the
caller's identity and the tool's input and return whether a human is needed. No
network calls, because identity was resolved once at the channel boundary.

```ts
export function writeApproval(): Approval {
  return (ctx) => {
    if (isAppPrincipal(ctx)) return "not-applicable"   // scheduled run
    return isWriteApprover(callerEmail(ctx)) ? "not-applicable" : "user-approval"
  }
}
```

`bulkApproval` additionally denies outright above a hard cap, and the denial
carries a reason the model reads — so it says "that would touch 40,000 records,
narrow the filter" rather than silently retrying.

**2. Who may answer** — `onInputResponse` in `agent/channels/slack.ts`. The
policies decide *whether* a human is needed; this decides *which* humans count.
Without it, anyone who can see a thread could approve their own write.

**3. Point-of-effect checks** — for ad spend. `spendApproval()` guarantees a human
approved. Returning the responder's auth from `onInputResponse` makes them the
resumed turn's current caller, and `requireSpendApprover(ctx)` at the top of each
spend tool's `execute` verifies that person is on the spend list. So the requester
cannot approve their own budget increase unless they are also a spend approver.

Plus two structural boundaries that are not policies at all:

- `validateReadOnlySoql` rejects DML, statement stacking, and comment-hidden
  mutations before a query is sent.
- The `data-analyst` subagent has no write tools in its directory. Subagents
  inherit nothing from the root, so there is no mutation surface to reach.

## Identity

One email, resolved once, used everywhere.

Slack: `authWithEmail` in the channel looks up the sender's email and stamps it
onto the session auth. Browser: `agent/channels/eve.ts` verifies the signed admin
cookie — the same cookie that gates `/console` — and stamps the same attribute.
Schedules run as an app principal with no email, which is what makes deletions and
sends refuse to fire unattended.

Every downstream check reads that attribute. That is why the approval policies are
pure, and why the browser chat and Slack enforce identical rules without
duplicating logic.

## Context management

The agent has to answer questions about data that does not fit in a context
window. Three mechanisms, in order of how much they help:

**The sandbox.** `export_salesforce_query` paginates the full result set, writes
it to `/workspace` as CSV, and returns a path plus a row count. The model then
runs pandas over the file. A 200,000-row answer costs a summary, not 200,000 rows.
Files people attach in Slack land in `/workspace/attachments`, so the same applies
to inbound data.

**Skills.** Seven playbooks in `agent/skills/`, advertised by description and
loaded only when a request matches. The base prompt stays small; the SOQL trap
list only enters context when someone is writing SOQL.

**Subagents.** The `data-analyst` investigates in its own context and returns a
written finding. The parent never sees the intermediate queries.

Compaction is on at 80% of the window, and per-session token limits pause and ask
rather than failing.

## What the framework replaced

For context on how much of this repo used to be transport plumbing:

| Was | Now |
| --- | --- |
| 638-line Slack events route, 351-line interactions route, HMAC verification, thinking-message lifecycle, thread history, markdown→mrkdwn, Block Kit cards, CSV upload | `agent/channels/slack.ts` |
| 200-line tool-wrapping block, Redis approval store, 30-minute TTL, `pending_approval` sentinel threaded through the model | declarative policies + durable HITL park |
| Provider branching in `src/lib/ai.ts` | one AI Gateway model id |
| Integration registry, tool assembly, prompt concatenation | filesystem discovery + dynamic instructions |
| PKCE helpers, OAuth state store, three callback routes | `defineInteractiveAuthorization` |
| Luma pending-event store and confirmation-card builder | the approval prompt is the confirmation |
| `cli.ts` and `POST /api/agent` | `npm run agent` and `/chat` |
| A second, context-blind model writing Linear issue titles | the agent writes them; it has the whole thread |
| A parallel SOQL prompt in the console route | the console asks the agent, so there is one SOQL brain |

The API clients under `agent/lib/<service>/` are the same code as before. That was
always the part worth keeping.

## One brain

There is exactly one place a model gets called: the agent. No route, tool, or
helper reaches for `generateText` on its own.

That was not free. The SOQL console had its own completion with its own SOQL
prompt and its own copy of the vocabulary injection — two implementations of the
same thing, drifting apart. It now posts to the agent's session API with an
`outputSchema`, forwarding the caller's cookie so the run is attributed to the
signed-in person. The console gained the `soql-authoring` skill and
`describe_salesforce_object` in the process, so it verifies field names instead of
guessing at them, which its old prompt explicitly told it to do.

Similarly, `file_linear_issue` used to hand the raw message to a small model that
wrote the title and body. That model saw one sentence; the agent calling it had
the entire thread. The tool now takes a written issue and files it, and the
briefing on how to write one lives in the tool description.

The test is `grep -rn "generateText\|generateObject" src/ agent/` returning
nothing. If you add a feature that wants its own model call, ask whether it should
be a tool or a subagent instead.

## Further reading

- [Fork this](fork-this.md) — making it yours
- [Adding integrations](adding-integrations.md)
- [Security](security.md)
- [eve docs](https://eve.dev/docs) — execution model, channels, tools, evals
