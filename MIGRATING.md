# Migrating from mOperator v1

v2 replaces the hand-rolled agent runtime with an [eve](https://eve.dev) agent.
If you are running the pre-eve version, this is what changes.

## Breaking changes

**1. The Slack request URL moved.**

In your Slack app settings, change both URLs from `/api/slack` to:

```
https://your-app.example.com/eve/v1/slack
```

- **Event Subscriptions → Request URL**
- **Interactivity & Shortcuts → Request URL**

The old routes are gone, so this is required. If you switch to Vercel Connect
(`npx eve add channel/slack`), Connect registers the destination for you and you
do not manage the URL at all.

**2. Slash commands are gone.**

`/moperator bug`, `/moperator feature`, `/moperator help`, `/moperator connect-sfdc`,
and `/moperator sfdc-status` no longer exist. Say the same thing in plain language
instead:

| Was | Now |
| --- | --- |
| `/moperator bug <text>` | "Bug: \<text\>" — or just describe it |
| `/moperator feature <text>` | "Feature request: \<text\>" |
| `/moperator help` | "What can you do?" |
| `/moperator connect-sfdc` | Nothing. The sign-in prompt appears inline the first time you make a write. |
| `/moperator sfdc-status` | "Am I connected to Salesforce?" |

Remove the slash command from your Slack app config, or leave it — it will just
404.

**3. `npm run cli` is gone.**

```bash
npm run agent    # terminal chat with the agent
```

Or use `/chat` in the browser, which is gated by the same admin sign-in as
`/console`.

**4. `POST /api/agent` is gone.**

If you were calling it from a script, use the eve session API
(`POST /eve/v1/session`) or `npx eve invoke "your prompt"`. Note that the routes
are authenticated — see `agent/channels/eve.ts`.

**5. Per-user Salesforce OAuth callback URL changed.**

eve mints its own callback URL. Run the flow once locally, note the URL from the
sign-in prompt, and register it in your Connected App. The old
`/api/integrations/salesforce/user-callback` is gone.

Stored tokens do not carry over — the store is keyed differently. People will be
asked to sign in again once.

**6. Tool names changed to snake_case.**

`querySalesforce` → `query_salesforce`, `createLinearIssue` → `file_linear_issue`,
and so on. This only matters if you referenced tool names anywhere — in a custom
prompt, or in analytics queries against the stored `tool` metadata. Historical
analytics rows keep their old names.

## Environment variables

**Removed:**

| Variable | Why |
| --- | --- |
| `AI_PROVIDER` | Replaced by a single AI Gateway model id. Set `AI_MODEL=anthropic/claude-opus-4.8` or `openai/gpt-5.5`. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Use `AI_GATEWAY_API_KEY`, or link the project and use its OIDC token. |
| `SLACK_BOT_USER_ID` | The channel filters its own messages. |
| `ADMIN_SLACK_USER_IDS` | Never used; authorization is by email. |

**Added, all optional:**

| Variable | What it does |
| --- | --- |
| `MOPERATOR_ORG_NAME` | So the agent knows whose CRM it is looking at |
| `MOPERATOR_TIMEZONE`, `MOPERATOR_FISCAL_YEAR_START_MONTH` | Correct answers to "this quarter" |
| `MOPERATOR_SLACK_CONNECTOR` | Use Vercel Connect instead of a bot token |
| `MOPERATOR_ALLOWED_SLACK_CHANNELS` | Restrict which channels can reach the agent |
| `MOPERATOR_CAMPAIGN_DIGEST_CHANNEL` and friends | Turn on the scheduled digests |
| `MOPERATOR_BULK_MAX`, `MOPERATOR_BULK_APPROVAL_THRESHOLD` | Write limits, previously hardcoded |
| `MOPERATOR_CAMPAIGN_NAME_PATTERN`, `MOPERATOR_UTM_MEDIUMS` | Conventions the new tracking tools enforce |

Everything else — `AUTHORIZED_USER_EMAILS`, `GROWTH_MARKETING_APPROVERS`,
`MOPERATOR_SESSION_SECRET`, and every integration credential — is unchanged.

## What is better

**Approvals survive everything.** They were Redis records with a 30-minute TTL; a
deploy mid-approval lost the operation, and a slow approver hit the expiry. Now the
turn itself pauses durably. No TTL, no store, and the work resumes exactly where it
stopped whenever someone answers.

**The agent no longer lies about pending writes.** It used to be handed
`pending_approval: true` and told to say "submitted for approval", so the
conversation ended mid-task. Now the turn genuinely pauses and then completes, so
it reports what actually happened.

**Answers come from all the data.** Query results go to a real filesystem and get
analyzed with pandas, instead of 50 rows entering the prompt. A CSV someone
attaches is read as a file rather than truncated to 10,000 characters.

**CSV export is not keyword-triggered.** It used to check whether your message
contained "csv" or "export". Now the agent decides to write a file and the channel
attaches it.

**Bulk limits are honest.** The cap is enforced in the approval policy with a
reason the model reads, so it narrows the query instead of retrying.

**Ad spend approval is verified twice** — at the gate and again at the moment of
effect, so the person who asked cannot approve their own budget increase unless
they are on the spend list.

## Doing the upgrade

```bash
git pull
npm install                 # ai v6 -> v7, adds eve, drops the provider SDKs
cp .env.example .env.local  # then copy your values across
npm run agent:info          # confirm your integrations are detected
npm run agent               # talk to it before touching Slack
npx vercel deploy --prod
```

Then update the two Slack request URLs.

`npm run agent:info` is the check worth doing carefully: it lists which
integrations are active. If one you expect is missing, its variables are not set —
the output names them.

## Your customizations

If you edited the old system prompt in `src/lib/agent-config.ts`, that content
now belongs in two places:

- Identity, tone, and behavior → `agent/instructions/00-identity.md`
- Procedures and checklists → a new file in `agent/skills/`

Do not paste the whole old prompt into `00-identity.md`. The integration list is
generated now, and the Slack mrkdwn instructions are obsolete — the channel
converts markdown for you, so write normal markdown with tables and headings.

Custom integrations you added under `src/lib/integrations/<name>/` port over
directly: the client moves to `agent/lib/<name>/client.ts` unchanged, and the
tools become one `agent/tools/<name>.ts` file. See
[docs/adding-integrations.md](docs/adding-integrations.md).
