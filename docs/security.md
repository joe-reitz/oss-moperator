# Security setup

mOperator is a power tool — once deployed, it can query your CRM, send Slack messages, and write campaign data. This guide walks through the env vars and Slack configuration that protect your deployment. **You only need to do this once per deployment.**

If you have a fresh clone of `oss-moperator` running locally and you want to ship it to a real Slack workspace, do everything in this doc before you share the bot link with anyone.

---

## 1. Generate two secrets

Open a terminal and run these two commands. Copy each output — you'll paste them into your `.env.local` (or your Vercel project's environment variables) in a minute.

```bash
openssl rand -hex 32  # → MOPERATOR_SESSION_SECRET
openssl rand -hex 32  # → MOPERATOR_TOKEN_ENCRYPTION_KEY  (only needed if you enable per-user Salesforce OAuth — skip otherwise)
```

These secrets stay on your server. They never leave it.

- `MOPERATOR_SESSION_SECRET` signs the admin login cookie. If it's missing, the `/console`, `/analytics`, and `/audience-vocab` pages will refuse to load.
- `MOPERATOR_TOKEN_ENCRYPTION_KEY` encrypts Salesforce refresh tokens at rest in Redis. Required unless you set `SFDC_IDENTITY=service` — see below.

---

## 2. Find your Slack signing secret

Slack signs every webhook it sends. Verifying that signature stops a stranger who finds your deployment URL from sending forged events.

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click your mOperator app.
3. In the left nav, click **Basic Information**.
4. Scroll to **App Credentials**.
5. Copy the **Signing Secret** value.
6. Paste it into your environment as `SLACK_SIGNING_SECRET`.

If you ever rotate this secret in Slack, you must update the env var and redeploy.

---

## 3. Enable Sign in with Slack (for admin pages)

The `/console`, `/analytics`, and `/audience-vocab` pages are gated to authorized users. Users sign in by clicking "Sign in with Slack" — we verify their email matches `AUTHORIZED_USER_EMAILS`, then set a signed cookie.

### One-time Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your mOperator app.
2. In the left nav, click **OAuth & Permissions**.
3. Scroll to **Redirect URLs** and click **Add New Redirect URL**.
4. Add: `https://YOUR-DOMAIN/api/admin/signin/callback`
   - For local dev with `npm run dev`, also add `http://localhost:3000/api/admin/signin/callback`.
5. Click **Save URLs**.
6. In the left nav, click **OpenID Connect** (under "Features").
7. If the toggle says "Enable OpenID Connect", flip it on.
8. Go back to **Basic Information** → **App Credentials**.
9. Copy the **Client ID** → set as `SLACK_CLIENT_ID`.
10. Copy the **Client Secret** → set as `SLACK_CLIENT_SECRET`.

### Configure who can sign in

Set `AUTHORIZED_USER_EMAILS` to a comma-separated list of Slack user emails:

```bash
AUTHORIZED_USER_EMAILS=alice@yourcompany.com,bob@yourcompany.com
```

Anyone whose Slack email is on this list can sign in to the admin pages. Anyone else gets a friendly "not authorized" message.

This same list does three things, which is worth being explicit about: it gates the admin pages including `/chat`, it lets these people write to the CRM without waiting for approval, and it lets them approve someone else's write.

An empty list means every write requires approval and nobody can grant one. That is safe, but the agent cannot change anything — set it before you expect writes to work.

Ad spend is separate and stricter. `GROWTH_MARKETING_APPROVERS` controls who can approve anything that moves budget, and unlike CRM writes it is required every time, including for the person who asked. It is checked twice: once at the gate, and again at the moment the change is applied.

---

## 4. Salesforce write identity (on by default)

By default, all Salesforce writes go through a single service account — so `CreatedById` shows that service account, not the actual person who clicked the Slack button. If you'd rather each user's writes show their own SFDC identity:

1. Leave `SFDC_IDENTITY=user` (the default).
2. Set `MOPERATOR_TOKEN_ENCRYPTION_KEY` (you generated this in step 1).
3. In your Salesforce Connected App, add a second redirect URI: `https://YOUR-DOMAIN/api/integrations/salesforce/user-callback`.
4. Tell your team to run `/moperator connect-sfdc` in Slack. Each user gets a one-time consent link.

Full details and threat model: [sfdc-per-user-oauth.md](/docs/sfdc-per-user-oauth).

---

## 5. Understand what the agent may do unsupervised

Worth five minutes before you go live, because the answer is not "nothing".

**Reads are ungated.** Anyone who can reach the agent can query anything the
service account can see. If that is too broad, narrow the Salesforce Connected
App's field-level security and object permissions — the agent inherits them.

**Writes are gated in code**, in `agent/lib/approval.ts`. Read that file; it is
short and it is the actual policy, not a description of one.

| Action | Who is needed |
| --- | --- |
| Single-record write | An approver, or approval from one |
| Bulk write over `MOPERATOR_BULK_APPROVAL_THRESHOLD` | Approval, from everyone including approvers |
| Bulk write over `MOPERATOR_BULK_MAX` | Refused outright |
| Delete | Approval always; never from a schedule |
| Trigger a Marketo campaign, publish an event | Approval always; never from a schedule |
| Any ad budget or status change | A spend approver, always, verified twice |

**Scheduled runs are unattended by design.** They can perform ordinary writes
without approval, and are refused for deletions, sends, and spend. The digests
that ship with this repo are read-only, and their prompts say so — if you write
your own, keep it that way, because a replayed step could otherwise repeat a
non-idempotent write.

**Who can approve** is enforced in `agent/channels/slack.ts` (`onInputResponse`).
Anyone not on an approver list has their click rejected with an explanation, and
the request stays open. If you add another channel — Teams, Discord — you must
copy that handler, or anyone on that platform who can see a prompt can answer it.

---

## 6. Deployment hardening

A few extra checks before you go live:

- **`NEXT_PUBLIC_APP_URL`** must be your real production domain. OAuth callbacks build redirect URIs from this value.
- **Salesforce IP allowlist** (Setup → Network Access): if your org restricts API access by IP, add your Vercel function egress IPs. Salesforce will refuse the token exchange otherwise.
- **Vercel Secure Compute**: if your org has Vercel Secure Compute, deploy mOperator into the isolated compute group that has access to your SFDC IP allowlist. Scope all environment variables to that compute group only.
- **Redis region**: keep `UPSTASH_REDIS_REST_URL` near your Vercel deployment. Redis is no longer in the approval path — approvals are durable pauses in the agent runtime — but it does back analytics, saved queries, the vocabulary, and per-user Salesforce grants.
- **Sandbox egress**: the agent has a sandbox with network access, used to install its data packages at template build time. If your threat model requires it, set a `networkPolicy` in `agent/sandbox/sandbox.ts` — see the [eve sandbox docs](https://eve.dev/docs/sandbox).
- **Review the tool surface**: run `npm run agent:info` against your production environment variables and read the list. Anything you do not want the agent able to do, delete the tool file.
- **Analytics retention**: events accumulate in Redis indefinitely. If you care about Redis size, add a weekly cron that trims `moperator:analytics:events` older than N days.

---

## 7. Local development

For `npm run dev` on `http://localhost:3000`:

- You do not need Slack at all for local development. `npm run agent` gives you a terminal chat, and `/chat` works with just the admin sign-in. Set up Slack when you are ready to put the agent in front of your team.
- If you do wire Slack locally, the channel verifies signatures whenever `SLACK_SIGNING_SECRET` is set. Using Vercel Connect instead (`npx eve add channel/slack`) means verification is handled for you and no Slack secret lives in your environment.
- You can also skip `SLACK_CLIENT_ID`/`SECRET` until you want to test the admin sign-in flow.
- Use [ngrok](https://ngrok.com/) or `vercel dev` to expose `localhost:3000` to Slack if you want to test the bot end-to-end.

---

## 8. Quick reference: required env vars

| Variable | Required | Why |
|---|---|---|
| `SLACK_SIGNING_SECRET` | Slack, unless using Connect | Verify every Slack webhook is real. Vercel Connect handles this instead |
| `SLACK_CLIENT_ID` | admin pages | OAuth client ID for Sign in with Slack |
| `SLACK_CLIENT_SECRET` | admin pages | OAuth client secret |
| `MOPERATOR_SESSION_SECRET` | admin pages | Signs the admin session cookie |
| `AUTHORIZED_USER_EMAILS` | writes | Who can reach the admin pages, write without waiting, and approve someone else's write |
| `GROWTH_MARKETING_APPROVERS` | ad spend | Who can approve a budget change. Defaults to the list above |
| `MOPERATOR_BULK_MAX` | no | Hard cap on records per bulk write. Defaults to 1500 |
| `MOPERATOR_BULK_APPROVAL_THRESHOLD` | no | Above this, a bulk write needs approval even from an approver. Defaults to 100 |
| `MOPERATOR_ALLOWED_SLACK_CHANNELS` | Slack Connect | Restrict the agent to specific channels. Set this if the app is in a channel with people outside your org |
| `MOPERATOR_TOKEN_ENCRYPTION_KEY` | per-user SFDC OAuth | AES-256-GCM key for refresh tokens in Redis |
| `SFDC_IDENTITY` | Salesforce writes | `user` (default), `user-all`, or `service`. Decides whether Salesforce records a person or the bot. |

---

## Common mistakes

- **"My signin button does nothing"** → check `SLACK_CLIENT_ID` is set and the redirect URL is registered in Slack.
- **"Slack says my redirect URL is invalid"** → the URL must match exactly, including trailing slashes (or lack of). Slack stores them literally.
- **"I keep getting `unauthorized` after signing in"** → your Slack email isn't on `AUTHORIZED_USER_EMAILS`. Note: case is normalized but the email must match exactly.
- **"`/eve/v1/slack` returns 401 for every request"** → `SLACK_SIGNING_SECRET` is wrong or stale. Re-copy from api.slack.com → Basic Information.
- **"All my requests work in dev but break in prod"** → you probably set `SLACK_SIGNING_SECRET` locally but forgot it in your Vercel project settings.
- **"Slack never reaches the agent at all"** → the request URL must be `/eve/v1/slack`, not `/api/slack`. See [MIGRATING.md](../MIGRATING.md) if you are upgrading.
- **"Approvals never appear"** → check `AUTHORIZED_USER_EMAILS` is set. With an empty list every write needs approval and nobody can grant one.
- **"I click Approve and nothing happens"** → your Slack email is not on an approver list. You should get an ephemeral message saying so; if you do not, the bot may be missing the `users:read.email` scope, in which case it cannot resolve anyone's email and treats everyone as a non-approver.
- **"The agent says an integration is not connected but I set the keys"** → run `npm run agent:info`. It lists which variables are missing for each integration.
