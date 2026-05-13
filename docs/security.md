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
- `MOPERATOR_TOKEN_ENCRYPTION_KEY` encrypts Salesforce refresh tokens at rest in Redis. Only required if you turn on `SFDC_USER_OAUTH_ENABLED=true`.

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

This same list also bypasses the Salesforce write approval flow.

---

## 4. (Optional) Per-user Salesforce OAuth

By default, all Salesforce writes go through a single service account — so `CreatedById` shows that service account, not the actual person who clicked the Slack button. If you'd rather each user's writes show their own SFDC identity:

1. Set `SFDC_USER_OAUTH_ENABLED=true`.
2. Set `MOPERATOR_TOKEN_ENCRYPTION_KEY` (you generated this in step 1).
3. In your Salesforce Connected App, add a second redirect URI: `https://YOUR-DOMAIN/api/integrations/salesforce/user-callback`.
4. Tell your team to run `/moperator connect-sfdc` in Slack. Each user gets a one-time consent link.

Full details and threat model: [sfdc-per-user-oauth.md](/docs/sfdc-per-user-oauth).

---

## 5. Deployment hardening

A few extra checks before you go live:

- **`NEXT_PUBLIC_APP_URL`** must be your real production domain. OAuth callbacks build redirect URIs from this value.
- **Salesforce IP allowlist** (Setup → Network Access): if your org restricts API access by IP, add your Vercel function egress IPs. Salesforce will refuse the token exchange otherwise.
- **Vercel Secure Compute**: if your org has Vercel Secure Compute, deploy mOperator into the isolated compute group that has access to your SFDC IP allowlist. Scope all environment variables to that compute group only.
- **Redis region**: keep `UPSTASH_REDIS_REST_URL` in the same region as your Vercel deployment for low-latency approvals.
- **Analytics retention**: events accumulate in Redis indefinitely. If you care about Redis size, add a weekly cron that trims `moperator:analytics:events` older than N days.

---

## 6. Local development

For `npm run dev` on `http://localhost:3000`:

- You can leave `SLACK_SIGNING_SECRET` unset locally — the app will allow unsigned requests in development with a loud warning. **Never deploy to production without setting it.**
- You can also skip `SLACK_CLIENT_ID`/`SECRET` until you want to test the admin sign-in flow.
- Use [ngrok](https://ngrok.com/) or `vercel dev` to expose `localhost:3000` to Slack if you want to test the bot end-to-end.

---

## 7. Quick reference: required env vars

| Variable | Required | Why |
|---|---|---|
| `SLACK_SIGNING_SECRET` | production | Verify every Slack webhook is real |
| `SLACK_CLIENT_ID` | admin pages | OAuth client ID for Sign in with Slack |
| `SLACK_CLIENT_SECRET` | admin pages | OAuth client secret |
| `MOPERATOR_SESSION_SECRET` | admin pages | Signs the admin session cookie |
| `AUTHORIZED_USER_EMAILS` | admin pages | Allowlist of emails that can access admin pages and bypass approvals |
| `MOPERATOR_TOKEN_ENCRYPTION_KEY` | per-user SFDC OAuth | AES-256-GCM key for refresh tokens in Redis |
| `SFDC_USER_OAUTH_ENABLED` | per-user SFDC OAuth | Master flag, defaults `false` |

---

## Common mistakes

- **"My signin button does nothing"** → check `SLACK_CLIENT_ID` is set and the redirect URL is registered in Slack.
- **"Slack says my redirect URL is invalid"** → the URL must match exactly, including trailing slashes (or lack of). Slack stores them literally.
- **"I keep getting `unauthorized` after signing in"** → your Slack email isn't on `AUTHORIZED_USER_EMAILS`. Note: case is normalized but the email must match exactly.
- **"`/api/slack` returns 401 for every request"** → `SLACK_SIGNING_SECRET` is wrong or stale. Re-copy from api.slack.com → Basic Information.
- **"All my requests work in dev but break in prod"** → you probably set `SLACK_SIGNING_SECRET` locally but forgot it in your Vercel project settings.
