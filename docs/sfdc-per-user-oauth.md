# Per-user Salesforce OAuth — Setup & Threat Model

By default, mOperator runs every Salesforce action under a single shared service account. Every record it creates shows the service account in `CreatedById`, every update shows it in `LastModifiedById`. That's fine if you don't care about per-user attribution — but if you'd like audit trails to show the actual person who clicked the Slack button, this feature is for you.

**Status in this codebase:** complete and feature-flagged off (`SFDC_USER_OAUTH_ENABLED=false` by default). Flip it on once your Salesforce admin has registered the new redirect URI.

---

## How it works (user-facing)

1. A team member runs `/moperator connect-sfdc` in Slack.
2. mOperator replies with an ephemeral message containing a *Connect Salesforce* button. The link expires in 10 minutes and is single-use.
3. The button goes to mOperator's server, which 302s the browser to Salesforce's standard OAuth consent screen.
4. The user signs in with their Salesforce credentials (or SSO) and grants consent.
5. Salesforce redirects back to mOperator, which exchanges the code for tokens, encrypts the refresh token, and stores it in Redis keyed by the user's Slack ID.
6. mOperator posts a confirmation back into the Slack channel.
7. From then on, when *that user* triggers a Salesforce action in Slack, mOperator uses their token. Records show `CreatedById = the user`. Anyone who hasn't connected falls back to the shared service account.

Two related slash commands:

- `/moperator sfdc-status` — show current connection details.
- `/moperator disconnect-sfdc` — remove the stored token (forces reconnect next time).

---

## Setup (one time per deployment)

### 1. Generate the encryption key

```bash
openssl rand -hex 32
```

Set it as `MOPERATOR_TOKEN_ENCRYPTION_KEY` in your environment. This key encrypts every refresh token at rest. **Treat it like a database password.** Losing it forces every user to reconnect.

### 2. Add a redirect URI in Salesforce

In your Salesforce Connected App settings:

1. Setup → App Manager → mOperator → View.
2. Click **Edit** in the OAuth Settings section.
3. Under **Callback URL**, add a new line: `https://YOUR-DOMAIN/api/integrations/salesforce/user-callback`
4. Confirm the existing service-account callback (`/api/integrations/salesforce/callback`) is still listed.
5. Confirm the OAuth scopes include `api`, `refresh_token`, and `offline_access`.
6. Save.

### 3. Decide on the authorization policy

In the same Connected App settings:

- **Self-Authorized** — any Salesforce user with the OAuth scope can connect. Simpler but less controlled.
- **Admin pre-approved** (recommended for production) — only users in a designated permission set can connect. Safer; lets you decide who's eligible.

### 4. Set the feature flag

```bash
SFDC_USER_OAUTH_ENABLED=true
```

Redeploy. The slash commands appear; existing flows continue to work.

### 5. Test with one user before sharing

Have one team member run `/moperator connect-sfdc`, complete the flow, and verify their `/moperator sfdc-status` shows the connection. Try a Salesforce action — confirm `CreatedById` in Salesforce shows them, not the service account.

---

## Token storage & encryption

**Storage key:** `moperator:sfdc-user-token:slack-user:<slackUserId>` in Upstash Redis. Value is JSON with the user's SFDC identity, instance URL, and **encrypted** refresh token. Plaintext refresh tokens never touch disk or logs.

**Algorithm:** AES-256-GCM, fresh random 12-byte IV per encryption, 16-byte auth tag stored alongside ciphertext. Decryption fails closed if any byte is altered.

**TTL:** records expire 90 days after last use. Each successful action refreshes the timer. Inactive users → token expires → forced reconnect, no manual cleanup.

---

## Threat model

| Concern | Mitigation |
|---|---|
| Stolen Redis snapshot | Refresh tokens encrypted with a key in env vars. Attacker needs both. |
| Stolen env vars | Rotate `MOPERATOR_TOKEN_ENCRYPTION_KEY` — this voids all stored tokens, forcing every user to reconnect. |
| User A completes user B's OAuth flow | The state nonce is server-side, single-use, keyed to the original Slack user who issued `/connect-sfdc`. SFDC's redirect cannot mint a token for a different Slack user. |
| Phishing — attacker sends fake "click here to connect" Slack message | Real connect link goes to your mOperator domain. A lookalike attacker domain would still hit the real Salesforce consent screen, which lists "mOperator" as the requesting app. |
| Replay of OAuth callback URL | State nonce is consumed (deleted) on first hit; second attempt returns "Connection link expired." |
| Logging of secrets | Tokens are never logged (only `slackUserId` and `sfdcUsername`). |

---

## Failure modes

- **Encryption key missing** → slash commands and callback fail with a clear "key not configured" error. Existing service-account flows are unaffected.
- **Feature flag off** → slash commands return "not enabled." All flows use the service account exactly as before.
- **User's token revoked** → API call returns `invalid_grant`. mOperator deletes the stored record automatically and tells the user to reconnect.
- **Redis down** → connect/disconnect fail loud. Existing service-account fallbacks continue to work.
- **Wrong redirect URI** → SFDC rejects the auth request with an OAuth error before tokens are minted. Surfaced on the callback page.

---

## Required env vars

| Variable | Required | Notes |
|---|---|---|
| `SFDC_USER_OAUTH_ENABLED` | yes (set to `true`) | Master feature flag. When unset, behavior is identical to a deployment without this feature. |
| `MOPERATOR_TOKEN_ENCRYPTION_KEY` | yes when feature is on | 64-char hex string (32 bytes). Generate with `openssl rand -hex 32`. |
| `NEXT_PUBLIC_APP_URL` | already required | Used to build the redirect URI. Must match what's registered in Salesforce. |
| `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` | already required | Same Connected App credentials. |
| `SALESFORCE_LOGIN_URL` | already required | `https://login.salesforce.com` for production. |

---

## What's in scope right now

This initial port ships the OAuth plumbing:

- `/moperator connect-sfdc`, `/moperator disconnect-sfdc`, `/moperator sfdc-status` slash commands.
- Encrypted Redis token store with 90-day TTL.
- `connect` and `user-callback` HTTP routes.
- `withSfdcRequest` in the Salesforce client accepts a `slackUserId` option to route through a per-user token.

**What's NOT yet wired:** the actual Slack agent loop and existing Salesforce tools don't yet thread `slackUserId` through to `withSfdcRequest`. So even after a user connects, current Slack-driven writes still use the service account. The connect/disconnect flow works, the token store works, and you can use `slackUserId` in any new code you write — but threading it through every existing tool is a follow-up PR.

If you want full per-user attribution today, you can add `opts: { slackUserId }` to each tool's `execute` callback and build the request context from `authContext.userId` in `src/app/api/slack/route.ts`. The plumbing is ready.

---

## Files

```
src/lib/integrations/salesforce/user-auth/
├── crypto.ts          AES-256-GCM helpers
├── store.ts           Encrypted per-user token store (Redis)
├── oauth-state.ts     OAuth state nonce store (Redis, 10-min TTL, single-use)
├── pkce.ts            PKCE code-verifier + challenge generator
└── connection.ts      getConnectionForUser + Salesforce OAuth config

src/app/api/integrations/salesforce/
├── connect/route.ts        Validates nonce, 302s to Salesforce
└── user-callback/route.ts  Consumes nonce, stores encrypted refresh token

src/app/api/slack/commands/handlers/
├── connectSfdc.ts
├── disconnectSfdc.ts
└── sfdcStatus.ts
```
