# mOperator

**Marketing Operations AI Agent** — A Slack bot that connects your marketing team to Salesforce, Linear, GitHub, and more using natural language.

Built with [Next.js](https://nextjs.org), [Vercel AI SDK](https://sdk.vercel.ai), and [Claude](https://anthropic.com/claude).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator&env=AI_GATEWAY_API_KEY,AI_PROVIDER,SLACK_BOT_TOKEN&envDescription=Required%20environment%20variables&envLink=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator%23environment-variables&project-name=moperator&repository-name=moperator)

---

## What It Does

mOperator is a Slack bot that lets marketing and sales teams interact with their tools using natural language:

- **"Show me active campaigns"** → Queries Salesforce
- **"Export contacts from Acme Corp as CSV"** → Runs SOQL, uploads CSV to Slack
- **"Bug: dashboard spinner never stops"** → Files a Linear issue with AI-enriched title and description
- **"What shipped this week?"** → Fetches GitHub commits and summarizes changes
- **"Create a search campaign with $200/day budget"** → Creates a Google Ads campaign (with approval)
- **"How are our Google Ads performing?"** → Pulls campaign metrics

### Key Features

- **Plug-and-play integrations** — Enable Salesforce, Linear, GitHub, Luma, and more just by adding env vars
- **SOQL Console** — A browser playground at `/console` that turns natural-language prompts into SOQL, runs them safely (read-only), and exports CSV
- **Analytics Dashboard** — A `/analytics` page that shows usage over time, top users, and most-used tools
- **Audience Vocabulary** — A `/audience-vocab` admin UI that maps marketer-speak ("segment", "tier") to your org's canonical Salesforce fields — used by both the SOQL console and the Slack agent
- **CSV export** — Query results automatically upload as Slack file attachments
- **Thread context** — Follow-up questions remember the conversation
- **Slash commands** — `/moperator bug`, `/moperator feature`, `/moperator help`, plus optional `/moperator connect-sfdc` for per-user Salesforce attribution
- **Approval workflow** — Salesforce / HubSpot / Marketo write operations require approval for non-authorized users
- **Ad spend safeguards** — Google Ads operations always require designated growth team approval
- **Per-user Salesforce OAuth** — Each Slack user can connect their own SFDC account so writes show their identity in `CreatedById` (encrypted token storage, optional)
- **Slack signature verification** — Every webhook is verified against your signing secret
- **Model flexibility** — Switch between Claude and GPT-4o with one env var

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/vercel/moperator.git
cd moperator
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

At minimum, you need:
- `AI_GATEWAY_API_KEY` — your [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key
- `SLACK_BOT_TOKEN` (see [Slack setup guide](docs/setup-slack-app.md))

### 3. Enable integrations

mOperator auto-discovers integrations based on env vars. Just add the keys for what you want:

| Integration | Required Env Vars | Setup Guide |
|-------------|-------------------|-------------|
| Salesforce  | `SALESFORCE_ACCESS_TOKEN`, `SALESFORCE_INSTANCE_URL` | [docs/setup-salesforce.md](docs/setup-salesforce.md) |
| Linear      | `LINEAR_API_KEY` | [docs/setup-linear.md](docs/setup-linear.md) |
| GitHub      | `GITHUB_TOKEN`, `GITHUB_REPO` | [docs/setup-github.md](docs/setup-github.md) |
| Google Ads  | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID` | [docs/setup-google-ads.md](docs/setup-google-ads.md) |
| Luma        | `LUMA_API_KEY` | Get the key from your Luma calendar settings |

### 4. Run locally

```bash
npm run dev
```

### 5. Deploy to Vercel

```bash
vercel deploy
```

Or click the Deploy button above.

See [docs/deploy-to-vercel.md](docs/deploy-to-vercel.md) for the full guide.

---

## Production Deployment Checklist

Before exposing mOperator beyond your local machine, work through this list. mOperator can query your CRM and write campaign data — treat its deployment like a production service. Full step-by-step instructions live in [docs/security.md](docs/security.md).

### Compute & network
- [ ] Set `NEXT_PUBLIC_APP_URL` to your production domain (used by every OAuth callback)
- [ ] If your org uses Vercel Secure Compute (or an equivalent isolated runtime), deploy mOperator into that compute group and scope its environment variables to that group only
- [ ] If Salesforce has IP allowlisting (Setup → Network Access), add your Vercel function egress IPs to the allowlist
- [ ] Confirm your Vercel project is on the right team — env vars are visible to all team members

### Auth & secrets
- [ ] Set `SLACK_SIGNING_SECRET` so every webhook is verified
- [ ] Generate `MOPERATOR_SESSION_SECRET` (`openssl rand -hex 32`) — required for the admin pages (`/console`, `/analytics`, `/audience-vocab`)
- [ ] Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` so users can sign in to admin pages
- [ ] Populate `AUTHORIZED_USER_EMAILS` — this list gates the admin pages and also bypasses the Salesforce write approval flow
- [ ] If you want per-user Salesforce attribution, generate `MOPERATOR_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) and set `SFDC_USER_OAUTH_ENABLED=true`. See [docs/sfdc-per-user-oauth.md](docs/sfdc-per-user-oauth.md).

### Salesforce hardening
- [ ] Scope your Connected App to only the objects and fields mOperator needs
- [ ] Register the per-user OAuth redirect URI in your Connected App: `{NEXT_PUBLIC_APP_URL}/api/integrations/salesforce/user-callback`
- [ ] Choose Connected App authorization policy: "Admin pre-approved users only" is safer than "All users self-authorize"

### Operational hygiene
- [ ] Confirm Redis (`UPSTASH_REDIS_REST_URL`) is in a region near your Vercel deployment
- [ ] Decide on analytics retention — events accumulate in `moperator:analytics:events` indefinitely; add a cleanup cron if it matters
- [ ] Test in a Slack workspace with one user before sharing the bot link with the team

---

## Architecture

```
CLI (npm run cli)     Slack (@mOperator)
    |                      |
    v                      v
POST /api/agent      POST /api/slack
    |                      |
    +----------+-----------+
               |
               v
    AI SDK (Claude / GPT-4o)
               |
               +-- Tools (auto-discovered):
                   +-- Salesforce (if configured)
                   +-- Linear (if configured)
                   +-- GitHub (if configured)
```

### Integration Module System

Each integration is a self-contained module in `src/lib/integrations/<name>/`:

```typescript
interface Integration {
  name: string
  description: string
  capabilities: string[]
  examples: string[]
  isConfigured: () => boolean  // Checks env vars
  getTools: () => Record<string, Tool>  // AI SDK tools
}
```

The system prompt dynamically lists only active integrations. See [docs/adding-integrations.md](docs/adding-integrations.md) to add your own.

---

## Environment Variables

See [`.env.example`](.env.example) for the full list with descriptions.

### Required

| Variable | Description |
|----------|-------------|
| `AI_GATEWAY_API_KEY` | Your Vercel AI Gateway API key ([docs](https://vercel.com/docs/ai-gateway)) |
| `AI_PROVIDER` | `"anthropic"` or `"openai"` (default: `anthropic`) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |

### Required for production (see [docs/security.md](docs/security.md))

| Variable | Description |
|----------|-------------|
| `SLACK_SIGNING_SECRET` | Verifies every Slack webhook. Refuses requests without it in production. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | OAuth credentials for the admin sign-in flow (gates `/console`, `/analytics`, `/audience-vocab`) |
| `MOPERATOR_SESSION_SECRET` | HMAC secret for admin session cookies. Generate: `openssl rand -hex 32` |
| `AUTHORIZED_USER_EMAILS` | Comma-separated emails. Gates admin pages and bypasses approval workflow. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Required for approvals, saved queries, analytics, vocab. |

### Optional

| Variable | Description |
|----------|-------------|
| `AI_GATEWAY_URL` | Custom AI Gateway URL (default: `https://ai-gateway.vercel.sh`) |
| `AI_MODEL` | Override the default model |
| `BOT_NAME` | Customize the bot name (default: "mOperator") |
| `SLACK_APPROVER_GROUP_ID` | Slack user group ID for @mentioning approvers (e.g., `S0123456789`) |
| `SLACK_BOT_USER_ID` | Bot's Slack user ID (for thread history) |
| `SFDC_USER_OAUTH_ENABLED` | Set `true` to enable per-user Salesforce OAuth. See [docs/sfdc-per-user-oauth.md](docs/sfdc-per-user-oauth.md). |
| `MOPERATOR_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for per-user SFDC tokens. Required when the flag above is on. |
| `LUMA_API_KEY` | Enables the Luma event creation tool. |

---

## Adding Your Own Integration

1. Create `src/lib/integrations/yourservice/`
2. Add `client.ts` (API client), `tools.ts` (AI SDK tools), `index.ts` (module export)
3. Register in `src/lib/integrations/index.ts`

See [docs/adding-integrations.md](docs/adding-integrations.md) for the full guide with a template.

---

## CLI

For testing without Slack:

```bash
npm run cli
```

This connects to `POST /api/agent` on your local dev server.

---

## License

MIT
