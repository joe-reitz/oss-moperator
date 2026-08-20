# mOperator

**A marketing operations agent you fork.** It lives in your Slack, works in your
CRM, and every rule it follows is a file you can edit.

Built on [eve](https://eve.dev), Vercel's framework for durable backend agents,
and deployed as a single Next.js project.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator&env=AI_GATEWAY_API_KEY,AUTHORIZED_USER_EMAILS,MOPERATOR_SESSION_SECRET&envDescription=Minimum%20to%20boot&envLink=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator%23environment&project-name=moperator&repository-name=moperator)

---

## What it does

```
"Which campaigns had the worst cost per conversion last month?"
  → pulls 90 days of ad performance, analyzes it in a sandbox, answers with
    a table and says which differences are too small to be meaningful

"Export every contact at Acme as a CSV"
  → paginates the full result set, writes it to a file, attaches it

"Add these 400 contacts to campaign 701xx000000ABCD"
  → states the count, then waits for a human to approve before writing

"Here's a list from the conference — dedupe it against Salesforce"
  → reads the attachment, normalizes emails, finds the 388 you already have
    and the 12 who unsubscribed, and recommends importing 642

"Raise the brand campaign budget to $300/day"
  → shows the current budget and the monthly delta, then requires a
    designated ad-spend approver to sign off

"Build this email — here's the approved copy"
  → hands the brief to Knak, which renders it on-brand, and reports back the
    asset with the copy reproduced verbatim and named to your convention

"Bug: the pricing form drops UTM parameters"
  → files an issue with a written title, body, priority, and labels
```

It reaches Salesforce, HubSpot, Marketo, Google Ads, Knak, GitHub, Luma, and your
project tracker — Linear, Asana, Jira, monday.com, or ClickUp — whichever you
configure, plus web search, a Linux sandbox, and its own CRM-safety rules.

## Why fork it instead of buying it

Marketing ops is not a generic problem. Your segment field is not their segment
field, your naming convention is real, your approval chain is specific, and the
five things your team asks for every week are not the five things another team
asks for. A closed product has to average over all of that. A fork does not.

Everything you would want to change is a file:

| To change | Edit |
| --- | --- |
| Who can approve what, naming and UTM conventions, limits | `agent/lib/config.ts` |
| How it talks and what it refuses | `agent/instructions/` |
| Its playbooks for SOQL, audiences, launches, list hygiene | `agent/skills/` |
| Which tools exist | `agent/tools/` — one file per integration |
| What "segment" means in your org | `/audience-vocab`, no deploy needed |
| Which writes need a human | `agent/lib/approval.ts` |
| Scheduled digests | `agent/schedules/` |

Delete an integration by deleting two paths. Add one with a client and a tool
file. The agent's own prompt updates itself from what is configured.

---

## Quick start

```bash
git clone https://github.com/vercel/moperator.git
cd moperator
npm install
cp .env.example .env.local
```

Set two things in `.env.local` and you have a working agent:

```bash
AI_GATEWAY_API_KEY=...        # https://vercel.com/docs/ai-gateway
AUTHORIZED_USER_EMAILS=you@company.com
MOPERATOR_SESSION_SECRET=...  # openssl rand -hex 32
```

Then pick how you want to talk to it:

```bash
npm run agent   # terminal chat with the agent (fastest loop, no Slack needed)
npm run dev     # the full app: site, /chat, /console, /analytics, docs
```

`npm run agent:info` prints exactly what the agent discovered — tools, skills,
schedules, and which integrations are active. Run it whenever something is
missing.

### Add integrations

Set the variables, restart. That is the whole step.

| Integration | Variables | Guide |
| --- | --- | --- |
| Salesforce | `SALESFORCE_ACCESS_TOKEN`, `SALESFORCE_INSTANCE_URL` | [docs](docs/setup-salesforce.md) |
| HubSpot | `HUBSPOT_API_TOKEN` | [docs](docs/setup-hubspot.md) |
| Marketo | `MARKETO_CLIENT_ID`, `MARKETO_CLIENT_SECRET`, `MARKETO_REST_ENDPOINT` | [docs](docs/setup-marketo.md) |
| Google Ads | `GOOGLE_ADS_CLIENT_ID`, `..._SECRET`, `..._DEVELOPER_TOKEN`, `..._CUSTOMER_ID` | [docs](docs/setup-google-ads.md) |
| Project tracker | any one of Linear, Asana, Jira, monday.com, ClickUp | [docs](docs/setup-project-tracker.md) |
| GitHub | `GITHUB_TOKEN`, `GITHUB_REPO` | [docs](docs/setup-github.md) |
| Knak | `KNAK_API_KEY` | [docs](docs/setup-knak.md) |
| Luma | `LUMA_API_KEY` | Key is in your Luma calendar settings |

The agent only sees tools for what is configured, so it never offers to do
something this install cannot do.

### Add Slack

```bash
npx eve add channel/slack
```

Choose Vercel Connect when asked. It manages the bot token, verifies inbound
requests, handles rotation, and supports multiple workspaces without a Slack
secret in your environment. Full walkthrough: [docs/setup-slack-app.md](docs/setup-slack-app.md).

### Deploy

```bash
npx vercel deploy --prod
```

One project serves the site, the admin pages, and the agent.
Schedules under `agent/schedules/` become Vercel Cron Jobs automatically.
See [docs/deploy-to-vercel.md](docs/deploy-to-vercel.md).

---

## How it keeps you out of trouble

An agent with write access to your CRM and your ad budget needs real guardrails,
not a polite prompt. These are enforced in code, in `agent/lib/approval.ts`:

- **CRM writes** go through automatically for people on the approver list.
  Everyone else's write pauses for one.
- **Bulk writes** are reviewed above a threshold no matter who asks, and refused
  outright above a hard cap. Splitting a batch to get under the limit does not
  work — the cap is per call and the agent is told why.
- **Deletions** and **anything that sends to real people** (a Marketo campaign,
  a published event page) always need a human, and can never run from a schedule.
- **Ad budget changes** always need a human, and specifically one on the ad-spend
  approver list — checked again at the moment the change is applied, so the
  person who asked cannot approve their own spend.
- **Read-only means read-only.** The SOQL the agent runs is validated against
  DML, statement stacking, and comment-hidden mutations. The `data-analyst`
  subagent has no write tools in its tool set at all.

A pause is durable. The turn suspends, Slack shows Approve / Deny, and the work
resumes exactly where it stopped when someone answers — minutes or days later,
across a redeploy. There is no expiry and nothing held in memory.

## What's in the box

**Browser chat** at `/chat` — same agent, same tools, same approval rules, no
Slack setup required.

**Sandbox analysis.** Query results go to a real filesystem as CSV and get
analyzed with pandas, so answers come from the whole result set instead of the
first fifty rows. Files people drop in Slack land in the same place.

**Skills** — on-demand playbooks for SOQL authoring, audience building, data
analysis, campaign launch, ads review, list hygiene, and event setup. Loaded only
when relevant, so the base prompt stays small.

**A read-only analyst subagent** for "go find out" work, with its own context and
no ability to change anything.

**Scheduled digests** — Monday campaign activity, daily ad-spend anomalies,
Friday triage. Inert until you name a channel.

**Tracking discipline** — UTM builder, UTM auditor, and campaign-name checker
that enforce your conventions, because one `paid_social` among a thousand
`paid-social` splits a channel in every report you will run this year.

**One tracker interface** — the same file/query/comment tools whether your team
runs Linear, Asana, Jira, monday.com, or ClickUp. Switching is a credential
change, and the agent picks up each tool's own vocabulary.

**SOQL console** at `/console`, **usage analytics** at `/analytics`, and an
**audience vocabulary** at `/audience-vocab` that teaches the agent what your
team means by "segment" or "tier" without a deploy.

**Evals** — `npm run eval` boots the real agent and checks it, so you can verify
your own fork rather than finding out in Slack.

---

## Docs

| | |
| --- | --- |
| [Fork this](docs/fork-this.md) | Make it yours in an afternoon |
| [Architecture](docs/architecture.md) | How the pieces fit |
| [Adding integrations](docs/adding-integrations.md) | Add a service, with a template |
| [More capabilities](docs/connections.md) | MCP servers and extensions worth adding |
| [Security](docs/security.md) | Production checklist |
| [Migrating from v1](MIGRATING.md) | If you ran the pre-eve version |

## Environment

See [`.env.example`](.env.example) — every variable, with what it does and
whether you need it.

## License

MIT
