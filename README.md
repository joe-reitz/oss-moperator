# mOperator

**Marketing Operations AI Agent** — A Slack bot that connects your marketing team to Salesforce, Linear, GitHub, and more using natural language.

Built with [Next.js](https://nextjs.org), [Vercel AI SDK](https://sdk.vercel.ai), and [Claude](https://anthropic.com/claude).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator&env=AI_PROVIDER,ANTHROPIC_API_KEY,SLACK_BOT_TOKEN&envDescription=Required%20environment%20variables&envLink=https%3A%2F%2Fgithub.com%2Fvercel%2Fmoperator%23environment-variables&project-name=moperator&repository-name=moperator)

---

## What It Does

mOperator is a Slack bot that lets marketing and sales teams interact with their tools using natural language:

- **"Show me active campaigns"** → Queries Salesforce
- **"Export contacts from Acme Corp as CSV"** → Runs SOQL, uploads CSV to Slack
- **"Bug: dashboard spinner never stops"** → Files a Linear issue with AI-enriched title and description
- **"What shipped this week?"** → Fetches GitHub commits and summarizes changes

### Key Features

- **Plug-and-play integrations** — Enable Salesforce, Linear, or GitHub just by adding env vars
- **CSV export** — Query results automatically upload as Slack file attachments
- **Thread context** — Follow-up questions remember the conversation
- **Slash commands** — `/moperator bug`, `/moperator feature`, `/moperator help`
- **AI-powered issue triage** — Raw bug reports get enriched with structured titles, descriptions, and priority
- **Admin controls** — Configurable delete permissions per Slack user
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
- `AI_PROVIDER` and `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`)
- `SLACK_BOT_TOKEN` (see [Slack setup guide](docs/setup-slack-app.md))

### 3. Enable integrations

mOperator auto-discovers integrations based on env vars. Just add the keys for what you want:

| Integration | Required Env Vars | Setup Guide |
|-------------|-------------------|-------------|
| Salesforce  | `SALESFORCE_ACCESS_TOKEN`, `SALESFORCE_INSTANCE_URL` | [docs/setup-salesforce.md](docs/setup-salesforce.md) |
| Linear      | `LINEAR_API_KEY` | [docs/setup-linear.md](docs/setup-linear.md) |
| GitHub      | `GITHUB_TOKEN`, `GITHUB_REPO` | [docs/setup-github.md](docs/setup-github.md) |

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
| `AI_PROVIDER` | `"anthropic"` or `"openai"` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (if using Claude) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |

### Optional

| Variable | Description |
|----------|-------------|
| `AI_MODEL` | Override the default model |
| `BOT_NAME` | Customize the bot name (default: "mOperator") |
| `ADMIN_SLACK_USER_IDS` | Comma-separated Slack user IDs with delete permissions |
| `SLACK_BOT_USER_ID` | Bot's Slack user ID (for thread history) |

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
