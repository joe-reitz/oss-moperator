# Fork this

mOperator is meant to be forked. This is the order to do it in, and roughly how
long each step takes.

The whole agent is the `agent/` directory. Nothing about it is hidden behind a
framework abstraction: instructions are markdown, tools are TypeScript files,
schedules are cron plus a prompt. `npm run agent:info` tells you exactly what the
framework found on disk, which is the fastest way to confirm a change landed.

---

## 1. Make it yours (20 minutes)

**`agent/lib/config.ts`** is the single customization surface. Read it top to
bottom once — it is short, and every field is something you probably want to
change.

Set at minimum:

```bash
BOT_NAME=Opsy
MOPERATOR_ORG_NAME=Acme
MOPERATOR_TIMEZONE=America/New_York
MOPERATOR_FISCAL_YEAR_START_MONTH=2      # if your FY does not start in January
AUTHORIZED_USER_EMAILS=you@acme.com,ops@acme.com
```

Then your conventions, which are the highest-value thing you can teach it:

```bash
MOPERATOR_CAMPAIGN_NAME_PATTERN=^(NAM|EMEA|APAC)-FY\d{2}Q[1-4]-[a-z0-9-]+$
MOPERATOR_CAMPAIGN_NAME_EXAMPLE=NAM-FY26Q1-webinar-observability
MOPERATOR_UTM_MEDIUMS=email,paid-search,paid-social,event,webinar
```

If your naming convention does not fit a regex, replace `check_campaign_name`
with something that does — it is one file, `agent/tools/check_campaign_name.ts`.

## 2. Teach it your vocabulary (30 minutes, highest payoff)

This is the difference between an agent that guesses at field names and one that
knows your org. When a marketer says "segment", which field do they mean?

Two ways, and you want both eventually:

- **`/audience-vocab`** — the admin UI. Stored in Redis, live immediately, no
  deploy. Best for experimenting and for terms that are still being argued about.
- **`AUDIENCE_VOCABULARY` in `agent/lib/vocabulary.ts`** — checked in, reviewed,
  ships with the build. Best for the mappings your team has settled.

An entry looks like this, and the `avoid` list is the part people underrate:

```ts
{
  term: "segment",
  aliases: ["customer segment", "tier"],
  object: "Account",
  field: "Customer_Segment__c",
  description: "Primary segmentation tier, set by RevOps monthly.",
  commonValues: ["Enterprise", "Mid-Market", "SMB"],
  avoid: [
    { field: "Segment__c", reason: "legacy, stopped syncing in 2024" },
  ],
  notes: "For Contact queries traverse Account.Customer_Segment__c.",
}
```

The vocabulary is injected into the system prompt at session start, so an edit
takes effect on the next conversation.

## 3. Rewrite the instructions (30 minutes)

`agent/instructions/` is the agent's character. Two files are yours to rewrite:

- **`00-identity.md`** — how it works and how it talks. The current version
  emphasizes counting before writing and preferring files over pasted rows. Keep
  what you agree with.
- **`10-safety.md`** — how it treats approvals and limits. Change this if your
  approval chain works differently.

Two files are generated and you should leave alone: `20-capabilities.ts` renders
the active integrations, and `30-vocabulary.ts` renders the vocabulary above.

Keep the base prompt short. Procedures belong in skills, which load only when
relevant.

## 4. Add your playbooks (an hour, ongoing)

`agent/skills/` is where the accumulated knowledge of your ops team goes. A skill
is a markdown file with a `description` in its frontmatter; the agent loads it
when a request matches that description.

The description is a routing hint, not a title. Write it as the situation that
should trigger it:

```markdown
---
description: Use when someone asks for the weekly exec metrics update, or for numbers that go in the Monday leadership deck.
---

# Weekly exec metrics

Pull these five numbers, in this order, from these exact fields...
```

Good candidates from your own team: the report someone rebuilds every Monday, the
checklist for launching in a new region, the three-step dance your CRM needs for
a lead handoff, the thing that always goes wrong at quarter end.

Start by writing down what you find yourself explaining to new hires.

## 5. Trim the integrations (10 minutes)

Delete what you do not use — every tool in the model's context is a chance for it
to reach for the wrong one.

To remove Marketo entirely:

```bash
rm agent/tools/marketo.ts
rm -rf agent/lib/marketo
# then drop its entry from INTEGRATIONS in agent/lib/integrations.ts
```

You do not have to do this for correctness — an unconfigured integration
contributes no tools — but a fork that only mentions the systems you actually run
is easier to read.

## 6. Turn on the schedules you want (10 minutes)

Three ship with the repo and all three are inert until you name a channel:

```bash
MOPERATOR_CAMPAIGN_DIGEST_CHANNEL=C0123ABC   # Mondays
MOPERATOR_AD_SPEND_DIGEST_CHANNEL=C0456DEF   # daily
MOPERATOR_TRIAGE_DIGEST_CHANNEL=C0789GHI     # Fridays
```

The prompt in each schedule is the whole job description — edit it directly. To
add your own, drop a file in `agent/schedules/`; it becomes a Vercel Cron Job on
deploy.

Test one without waiting for its cron:

```bash
npm run agent   # in another terminal
curl -X POST http://localhost:2000/eve/v1/dev/schedules/campaign-digest
```

## 7. Write an eval for the thing you care about most (20 minutes)

Pick the behavior that would embarrass you if it broke, and pin it:

```ts
// evals/my-team/monday-report.eval.ts
import { defineEval } from "eve/evals"
import { includes } from "eve/evals/expect"

export default defineEval({
  description: "The Monday report uses the right source object.",
  async test(t) {
    await t.send("Give me the Monday leadership numbers")
    t.succeeded()
    t.calledTool("query_salesforce")
    t.check(t.reply, includes("Pipeline"))
  },
})
```

Then `npm run eval`. This is how you find out a prompt edit broke something,
before your team does.

---

## Where things live

```
agent/
├── agent.ts              model, reasoning, limits
├── lib/config.ts         ← start here
├── instructions/         who it is, how it behaves
├── skills/               ← your playbooks go here
├── tools/                one file per integration + always-on tools
├── lib/<service>/        API clients
├── lib/approval.ts       which writes need a human
├── channels/slack.ts     who may talk to it, who may approve
├── channels/eve.ts       who may reach it from a browser
├── subagents/            specialists with their own tool surface
├── schedules/            recurring jobs
├── hooks/                lifecycle observers (usage analytics)
└── sandbox/              the workspace and its data tooling

evals/                    checks you can run against your own fork
src/app/                  site, /chat, /console, /analytics, /audience-vocab
```

## The loop

```bash
npm run agent         # terminal chat, hot reload on save
npm run agent:info    # what did the framework actually find?
npm run typecheck
npm run eval
```

`npm run agent:info` first whenever something is missing. It reports discovery
errors with file paths, which is almost always faster than reading logs.

## Things worth knowing

**Approvals are durable pauses, not stored records.** A pending approval survives
a redeploy and never expires. Do not build a TTL or a reminder job for it.

**Dynamic tool files must keep `execute` inline.** In `agent/tools/*.ts` files
that use `defineDynamic`, write `execute` as an inline function. Assigning
`execute: someFunction` works on the first step but breaks when the runtime
replays it.

**Subagents inherit nothing.** A subagent under `agent/subagents/<name>/` gets
only what is authored in its own directory — that is what makes the read-only
analyst genuinely read-only, and it is also why it declares its own sandbox.

**The system prompt configures itself.** Do not hand-write a list of integrations
into `instructions/`; `20-capabilities.ts` already renders the live set.

## Going further

- [Adding integrations](adding-integrations.md) — a service that is not in the box
- [More capabilities](connections.md) — MCP servers, other channels, memory
- [Architecture](architecture.md) — how the runtime actually works
- [Security](security.md) — before you point this at production data
- [eve docs](https://eve.dev/docs) — the framework underneath
