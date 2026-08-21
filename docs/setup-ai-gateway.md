# Setting Up AI for mOperator

mOperator needs an AI model to work. You have two options for connecting one:

| | AI Gateway (Recommended) | Direct API Key |
|---|---|---|
| **Setup** | One Vercel API key | One provider-specific key |
| **Switch models** | Change an env var | Change code + keys |
| **Providers** | Anthropic, OpenAI, and more | One at a time |
| **Logging** | Built-in usage dashboard | Roll your own |
| **Best for** | Teams, production, flexibility | Quick start, single model |

Pick whichever fits your situation. You can always switch later.

---

## Option A: Vercel AI Gateway (Recommended)

AI Gateway is a proxy that routes your AI requests to any supported model provider. One key gives you access to Claude, GPT-4o, and future models. When a better model comes out, you change one env var — no refactoring, no new API keys, no code changes.

### Why AI Gateway?

- **Model flexibility** — Switch models by changing one string — `AI_MODEL`, or `npx eve set --model <id>`. No code changes, no second SDK.
- **One key to manage** — Instead of juggling API keys for Anthropic, OpenAI, and whatever comes next, you manage one Vercel token.
- **Built-in logging** — See usage, costs, and request history in your Vercel dashboard.
- **Future-proof** — As new AI providers and models launch, AI Gateway adds support. Your app just works.

### Step 1: You Need a Vercel Account

If you followed the [Deploy to Vercel](/docs/deploy) guide, you already have one. If not:

1. Go to [vercel.com](https://vercel.com)
2. Click **"Sign Up"** (free tier works)

### Step 2: Create an API Key

1. Go to your Vercel dashboard at [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your **avatar** in the top-right → **"Settings"**
3. Navigate to **"Tokens"**
4. Click **"Create Token"**
5. Name it `mOperator`, set scope to your account
6. Copy the token — you won't see it again

### Step 3: Add to Environment

Add to your `.env.local`:

```bash
AI_GATEWAY_API_KEY=your-vercel-token-here
# AI_MODEL=anthropic/claude-opus-4.8
```

That's it. The default model is `claude-sonnet-4-5-20250929`. To use OpenAI instead:

```bash
AI_GATEWAY_API_KEY=your-vercel-token-here
# AI_MODEL=openai/gpt-5.5
```

Optional overrides:

```bash
# AI_GATEWAY_URL=https://ai-gateway.vercel.sh   # Default, rarely needs changing
# AI_MODEL=claude-sonnet-4-5-20250929            # Override specific model
```

---

## Option B: a provider key directly

Not supported any more, and worth explaining rather than leaving you to discover
it.

`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` used to work, because the agent imported
`@ai-sdk/anthropic` and `@ai-sdk/openai` and branched on an `AI_PROVIDER`
variable. That branching is gone: `agent/agent.ts` takes a single AI Gateway
model id, so one credential reaches every model and switching providers is a
string change.

If you specifically need to call a provider directly — an enterprise agreement,
a model the gateway does not carry, a self-hosted endpoint — it is a small change
rather than a supported flag:

```bash
npm install @ai-sdk/anthropic
```

```ts
// agent/agent.ts
import { anthropic } from "@ai-sdk/anthropic"
import { defineAgent } from "eve"

export default defineAgent({
  model: anthropic("claude-opus-4-8"),
})
```

Note the id format differs: a direct provider uses its own naming
(`claude-opus-4-8`), while the gateway uses `anthropic/claude-opus-4.8`.

Doing this gives up per-model routing, the shared spend view, and the OIDC option
below, and you take on a provider key to store and rotate. It is the right call
occasionally and the wrong default.

---

## Option C: no key at all (OIDC)

On Vercel you can skip the API key. Vercel mints a short-lived OIDC token scoped
to your project, the AI Gateway accepts it, and the AI SDK picks it up
automatically. Nothing to store, nothing to rotate, and nothing that keeps
working after someone leaves the team.

### In production and preview: nothing to add

It is automatic for a deployed, linked project. Do not create an env var called
`VERCEL_OIDC_TOKEN` — Vercel injects it, and a stale hand-written one would
override the live token and start failing after two hours.

Deploy with no AI credential and try a real turn. If it works, you are done. If
it 401s, fall back to an API key — one command, and the two are interchangeable:

```bash
vercel env add AI_GATEWAY_API_KEY production
```

Under the hood the token reaches a Vercel Function as an `x-vercel-oidc-token`
header rather than an environment variable. Vercel reuses one for up to 90
minutes against a two-hour TTL, so the spare 30 minutes covers a long-running
function. That is a detail the SDK handles; it matters only if you are reading
the token yourself.

### Locally: run the command through Vercel

```bash
vercel link                            # once
vercel env run -- npm run agent        # fresh token, nothing written to disk
vercel env run -- npm run dev
```

`vercel env run` fetches your development environment variables and a fresh OIDC
token from the linked project, passes them to the command, and writes nothing to
the filesystem. That is the whole point: no credential on disk to leak, and no
expiry to think about, because you get a new token every time you start.

The alternative writes them to a file:

```bash
vercel env pull    # writes .env.local
```

Two reasons to prefer `env run`:

- **The pulled token expires after 12 hours.** When it does, the agent stops
  reaching the model in a way that looks like a broken install rather than an
  expired credential.
- **`env pull` overwrites `.env.local` wholesale.** Any local-only variable you
  hand-added that does not exist in Vercel is gone. It prompts first; `--yes`
  skips the prompt, which is how people lose a file.

Use `env pull` when a tool needs a real file and cannot be wrapped. Otherwise
`env run`.

### So do you need an API key at all?

For a Vercel deployment: **no.** Not in production, and not locally either.

The one place you still need one is where nothing can mint a token for you:

| Where | Credential | Why |
| --- | --- | --- |
| Production and preview on Vercel | OIDC, automatic | nothing to set, nothing stored |
| Local development | OIDC via `vercel env run` | fresh per run, nothing on disk |
| CI (GitHub Actions) | `AI_GATEWAY_API_KEY` secret | no linked Vercel project to issue a token |
| Self-hosted, or another cloud | `AI_GATEWAY_API_KEY` | Vercel is not the one running it |

The security difference is real, not cosmetic:

| | API key | OIDC token |
| --- | --- | --- |
| Lifetime | until revoked | 2 hours in a Function, 12 hours pulled locally |
| Stored where | Vercel's env store, and a file on your laptop | nowhere in production — injected per invocation |
| If it leaks | spends money until someone notices and revokes it | expires on its own |
| Tied to | the person who created it | the project |

That last row matters more than it looks. Vercel deactivates API keys when their
creator leaves the team, so a key created by a departing colleague takes your
agent down with them. An OIDC token belongs to the project.

### Not the same as the agent's route auth

Confusingly, this repo uses Vercel OIDC for a second, unrelated purpose. In
`agent/channels/eve.ts`, `vercelOidc()` verifies **inbound** requests — it is how
schedules, subagents, and the eve CLI authenticate *to* the agent's own routes.

Two directions, same mechanism:

- **Outbound** (this page): the agent proving who it is to the AI Gateway.
- **Inbound** (`agent/channels/eve.ts`): callers proving who they are to the agent.

Setting `AI_GATEWAY_API_KEY` has no effect on the inbound side, and removing
`vercelOidc()` from the auth walk has no effect on model access.

---

## Test the Connection

Start your app:

```bash
npm run dev
```

Test via CLI:

```bash
npm run agent
```

Type something like:

```
hello, are you working?
```

If you get a response, you're connected.

## Choosing a Model

mOperator defaults to these models:

| Provider | Default Model | Good For |
|---|---|---|
| Anthropic | `claude-sonnet-4-5-20250929` | Tool use, structured data, long context |
| OpenAI | `gpt-4o` | General purpose, fast responses |

To override the model, set `AI_MODEL` in your `.env.local`:

```bash
AI_MODEL=claude-sonnet-4-5-20250929
```

## Troubleshooting

### "No AI key configured"
- Make sure you've set `AI_GATEWAY_API_KEY`, or that `vercel env pull` has put a
  fresh `VERCEL_OIDC_TOKEN` in `.env.local` (it expires after 12 hours)
- Run `npm run agent:doctor` — it reports which credential it found and whether
  the gateway accepted it
- Restart the dev server after changing env vars

### "401 Unauthorized"
- Verify your API key is correct (no extra spaces or line breaks)
- For AI Gateway: check the token hasn't been revoked in Vercel settings
- For direct keys: check the key is active in the provider's console

### "Model not found"
- Check `AI_MODEL` is a valid AI Gateway model id, e.g. `anthropic/claude-opus-4.8`
- If using a custom `AI_MODEL`, verify the model name matches what the provider supports

## Cost

- **Vercel AI Gateway** itself is free — you pay for model usage
- **Anthropic Claude**: ~$3 per million input tokens, ~$15 per million output tokens
- **OpenAI GPT-4o**: ~$2.50 per million input tokens, ~$10 per million output tokens
- Typical cost for a small team: $5–20/month depending on usage

## Next Steps

1. [Create a Slack App](/docs/slack) so your team can talk to mOperator
2. Optionally connect [Salesforce](/docs/salesforce), [project management](/docs/project-management), or [GitHub](/docs/github)
