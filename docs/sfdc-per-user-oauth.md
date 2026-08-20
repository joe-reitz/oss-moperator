# Salesforce write identity

Salesforce already has a real audit trail. `CreatedById` and `LastModifiedById`
on every record, Field History Tracking with before and after values per field,
and the Setup Audit Trail for configuration. It is authoritative, queryable with
SOQL, retained under your org's policy, and already inside whatever compliance
regime you run.

The one thing that makes it useless for an agent is a shared service account. If
every change mOperator makes says "mOperator Integration User", the trail records
that a bot did everything and answers none of the questions anyone actually asks
— who changed this, why, on whose authority.

So mOperator does not build its own audit log. It makes Salesforce's audit log
correct, by having each person's changes carry **their own Salesforce identity**.

## The rule

A Salesforce change is recorded under the person who asked for it. If it cannot
be, **the change does not happen**.

There is no silent fallback to the service account. That is the entire point: a
quiet downgrade produces exactly the audit trail you believe you have and do not,
and you would not find out until someone asked a question it cannot answer.

Concretely, a write is refused — with a reason, not a stack trace — when:

- the requester has not connected their Salesforce account **and is not present**
  to complete the one-time sign-in (typically an approver resuming a parked write
  on someone else's behalf)
- the run is a **schedule**, which has nobody to attribute to
- the requester's **email cannot be resolved** (in Slack, usually a missing
  `users:read.email` scope)
- per-user identity is configured but its **prerequisites are missing**

## Modes

```bash
SFDC_IDENTITY=user       # default
```

| Mode | Writes | Reads |
| --- | --- | --- |
| `user` | the requester's own identity | service account |
| `user-all` | the requester's own identity | the requester's own identity |
| `service` | service account | service account |

`user` is the default because reads carry no attribution value and nobody should
have to sign in to ask a question.

`user-all` is worth considering for a second reason that has nothing to do with
auditing: reads then run under the person's own Salesforce permissions, so
sharing rules and field-level security apply and **the agent cannot surface a
record they could not open themselves**. If your org uses record-level sharing
seriously, this closes a real hole.

`service` is an explicit opt-out. Choose it knowingly — every change will read as
the integration user.

## How it looks to a user

1. Someone asks for a Salesforce change.
2. The turn pauses and they get a private sign-in link — an ephemeral message in
   Slack, an inline prompt in `/chat`.
3. They sign in. The turn resumes exactly where it stopped and completes.
4. They are not asked again. The grant lasts 90 days from last use.

Nobody runs a command to connect. `salesforce_connection_status` answers "am I
connected?" without having to attempt a write to find out.

Grants are keyed by **email**, so one person has one grant whether they reach the
agent from Slack or from the browser.

## Attribution follows the requester, not the approver

When a write parks for approval and somebody else clicks Approve, eve makes the
approver the turn's current caller. Salesforce is still told the **requester**
made the change, because they are the one who wanted it — and the approval itself
is recorded in the Slack thread, which is durable and searchable.

This is why an approver cannot rescue a write from someone who has not connected:
attributing it to the approver would misreport who wanted the change, which is
the failure this design exists to prevent.

## Setup

### 1. Environment

```bash
SFDC_IDENTITY=user   # the default; set it explicitly so intent is visible

# Your Connected App, same one the service account uses
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_LOGIN_URL=https://login.salesforce.com

# Encrypts stored refresh tokens. Generate: openssl rand -hex 32
MOPERATOR_TOKEN_ENCRYPTION_KEY=

# Required — grants are stored here
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

If Redis or the encryption key is missing, writes are **refused** with a message
naming what is unset. They do not fall back to the service account — see the rule
above. Run `npm run agent:info` and check the Salesforce entry before deploying.

### 2. Register the redirect URI

The framework mints the callback URL, so read it rather than guessing. Run the
agent locally, trigger a write, and copy the URL from the sign-in prompt:

```bash
npm run agent
# then: "update the Description on Campaign 701xxx to 'test'"
```

Add that URL to your Connected App under **Setup → App Manager → your app →
Edit → Callback URL**. You will need both the local and the production form.

### 3. Connected App settings

- **Selected OAuth Scopes:** `api`, `refresh_token`, `offline_access`
- **Require Secret for Web Server Flow:** on
- **Permitted Users:** "Admin approved users are pre-authorized" is the safer
  choice — then grant the profiles or permission sets that should be able to use
  the agent. "All users may self-authorize" works but means anyone in the org can
  bind their account.
- **Refresh Token Policy:** "Refresh token is valid until revoked", or a fixed
  window if your security team requires one. A shorter window means periodic
  re-authorization, which the flow handles.

### 4. Verify

Have one person trigger a write, complete the sign-in, and then check the record
in Salesforce. `LastModifiedById` should be them, not the service account.

## Turn on the Salesforce side too

Per-user identity makes the trail *meaningful*; these make it *complete*. Both
are org configuration, not something this repo can set:

- **Field History Tracking** on the objects and fields the agent writes —
  Campaign, CampaignMember, Contact, Lead, plus any custom field it updates.
  Without it you get "who last touched this record" but not what changed.
  Setup → Object Manager → *object* → Fields & Relationships → Set History Tracking.
- **Setup Audit Trail** is on by default and covers configuration changes. Export
  it periodically; Salesforce retains six months in the UI.

Name the service account something unmistakable — "mOperator Integration User"
rather than a person's name — so the changes that legitimately are the bot's
(reads under `user` mode, anything under `service`) are obvious in a report.

## Who uses their own token

| Caller | Credentials |
| --- | --- |
| A person in Slack or `/chat` who has signed in | Their own Salesforce account |
| A person who has not signed in yet | Prompted; the turn waits durably |
| An approver resuming someone else's parked write | Recorded as the requester, or refused if they never connected |
| A scheduled run | Refused. There is nobody to attribute to. |
| The `data-analyst` subagent | The service account; it is read-only |

Scheduled runs deliberately do not attempt a sign-in — a cron job has no human to
answer a prompt, so it would park forever — and they are not allowed to write as
the service account either. Keep scheduled work to reading and reporting; the
digests that ship with this repo already do.

## Revoking

**One person:** in Salesforce, **Setup → Connected Apps OAuth Usage → your app →
User's Access → Revoke**. The next call fails its refresh and they are asked to
sign in again.

**Everyone:** rotate `MOPERATOR_TOKEN_ENCRYPTION_KEY`. Every stored grant becomes
undecryptable, is treated as "not connected", and each person is re-prompted. This
is the fastest way to invalidate the whole set.

**Turning it off:** set `SFDC_IDENTITY=service`. Writes go back to the service
account immediately, and every change from then on is recorded as the integration
user. Stored grants remain in Redis until their TTL
expires; delete the `moperator:sfdc-user-token:*` keys if you want them gone now.

## Threat model

**What this improves.** Attribution is real. Salesforce's own permission model
applies per person, so someone who cannot edit Opportunities cannot get the agent
to edit one for them. Revocation is per person and immediate.

**What it does not change.** The service account still exists and is still used
for reads, schedules, and anyone who has not signed in — so scope it tightly
regardless. A refresh token in Redis is a real credential: encrypted at rest, but
someone with both your Redis credentials and `MOPERATOR_TOKEN_ENCRYPTION_KEY` can
use it. Keep them in different places, and prefer a Vercel project whose
environment variables are scoped to the people who need them.

**What it does not do.** This is authentication, not authorization. Whether the
agent *should* make a change is decided by the approval policies in
`agent/lib/approval.ts`. Per-user OAuth answers "in whose name", not "should this
happen at all" — you want both.

## Where the code is

```
agent/lib/salesforce/auth.ts          the flow: getToken, start, complete
agent/lib/salesforce/token-store.ts   encrypted grants in Redis, 90-day TTL
agent/lib/salesforce/crypto.ts        AES-256-GCM with a per-value IV
agent/lib/salesforce/client.ts        accepts injected credentials
```

Every Salesforce tool calls `resolveSfdcCredentials(ctx)` and passes the result to
the client. That function returns `null` — meaning "use the service account" —
whenever the feature is off, the caller is not a person, or the store is not
configured, which is why enabling this cannot break an install.
