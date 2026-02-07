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

- **Model flexibility** — Switch from Claude to GPT-4o (or the next big model) by changing `AI_PROVIDER` in your env vars. No code changes.
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
AI_PROVIDER=anthropic
```

That's it. The default model is `claude-sonnet-4-5-20250929`. To use OpenAI instead:

```bash
AI_GATEWAY_API_KEY=your-vercel-token-here
AI_PROVIDER=openai
```

Optional overrides:

```bash
# AI_GATEWAY_URL=https://ai-gateway.vercel.sh   # Default, rarely needs changing
# AI_MODEL=claude-sonnet-4-5-20250929            # Override specific model
```

---

## Option B: Direct API Key

If you just want to get running with a single provider and don't need the flexibility of AI Gateway, you can plug in an API key directly.

### For Anthropic (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **"API Keys"** and create a new key
4. Add to `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
AI_PROVIDER=anthropic
```

### For OpenAI (GPT-4o)

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Go to **"API Keys"** and create a new key
4. Add to `.env.local`:

```bash
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
AI_PROVIDER=openai
```

### Note

With direct keys, switching providers means getting a new API key from a different provider and updating your code/config. AI Gateway removes this friction — but either approach works.

---

## Test the Connection

Start your app:

```bash
npm run dev
```

Test via CLI:

```bash
npm run cli
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
- Make sure you've set either `AI_GATEWAY_API_KEY` or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
- Restart the dev server after changing env vars

### "401 Unauthorized"
- Verify your API key is correct (no extra spaces or line breaks)
- For AI Gateway: check the token hasn't been revoked in Vercel settings
- For direct keys: check the key is active in the provider's console

### "Model not found"
- Check `AI_PROVIDER` is set to `anthropic` or `openai`
- If using a custom `AI_MODEL`, verify the model name matches what the provider supports

## Cost

- **Vercel AI Gateway** itself is free — you pay for model usage
- **Anthropic Claude**: ~$3 per million input tokens, ~$15 per million output tokens
- **OpenAI GPT-4o**: ~$2.50 per million input tokens, ~$10 per million output tokens
- Typical cost for a small team: $5–20/month depending on usage

## Next Steps

1. [Create a Slack App](/docs/slack) so your team can talk to mOperator
2. Optionally connect [Salesforce](/docs/salesforce), [project management](/docs/project-management), or [GitHub](/docs/github)
