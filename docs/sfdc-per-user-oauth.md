# Per-user Salesforce OAuth

By default, mOperator writes to Salesforce as a single service account. Every
record it touches shows that account in `CreatedById` and `LastModifiedById`, so
your audit trail says "the bot did it" and nothing about who asked.

Turn this on and each person signs in to their own Salesforce account instead. The
audit trail names the human, and Salesforce's own field-level security, sharing
rules, and profile permissions apply to that person rather than to a service user
with broad access.

## How it looks to a user

1. Someone asks for a Salesforce write.
2. The turn pauses and they get a private sign-in link — an ephemeral message in
   Slack, an inline prompt in `/chat`.
3. They sign in. The turn resumes exactly where it stopped and completes the write.
4. They are not asked again. The stored grant lasts 90 days from last use.

Nothing about reads changes, and nothing about the approval flow changes — an
approval and a sign-in can both be pending, and the user is asked to approve
first, then sign in, never both twice.

## What runs it

The agent runtime owns the flow: it mints the callback URL, suspends the turn
durably at the sign-in prompt, resumes it after the redirect, and renders the
challenge natively per channel. That is `agent/lib/salesforce/auth.ts`, about 200
lines, and it replaced the PKCE helpers, OAuth state store, and three callback
routes the previous version carried.

It does not own storage. Refresh tokens live in `agent/lib/salesforce/token-store.ts`,
encrypted with AES-256-GCM, keyed by principal, with a 90-day sliding expiry. You
need Redis and an encryption key for that.

## Setup

### 1. Environment

```bash
SFDC_USER_OAUTH_ENABLED=true

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

If Redis or the encryption key is missing, the agent logs a warning and falls back
to the service account. It never silently loses the ability to work.

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

## Who uses their own token

| Caller | Credentials |
| --- | --- |
| A person in Slack or `/chat` who has signed in | Their own Salesforce account |
| A person who has not signed in yet | They are prompted; the turn waits |
| A scheduled run | The service account — there is nobody to prompt |
| The `data-analyst` subagent | The service account; it is read-only |

Scheduled runs deliberately do not attempt a sign-in. A cron job has no human to
answer a prompt, so it would park forever.

## Revoking

**One person:** in Salesforce, **Setup → Connected Apps OAuth Usage → your app →
User's Access → Revoke**. The next call fails its refresh and they are asked to
sign in again.

**Everyone:** rotate `MOPERATOR_TOKEN_ENCRYPTION_KEY`. Every stored grant becomes
undecryptable, is treated as "not connected", and each person is re-prompted. This
is the fastest way to invalidate the whole set.

**Turning the feature off:** unset `SFDC_USER_OAUTH_ENABLED`. Writes go back to
the service account immediately. Stored grants remain in Redis until their TTL
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
