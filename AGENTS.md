# Agents Guide for mOperator

This document provides context for developers and AI assistants working on this codebase.

## Project Vision

mOperator is an **open-source orchestration layer for Marketing Operations**. It's a platform that connects marketing tools through a unified natural language interface (Slack), not a collection of point solutions.

The core thesis: **One interface, many capabilities, composable workflows.**

## Architecture Principles

### 1. Tool-Based Agent Architecture

mOperator uses an AI model (Claude or GPT-4o) as the reasoning engine. The model doesn't execute actions directly — it decides which **tools** to call based on user intent.

```
User Message → AI Model → Tool Selection → Tool Execution → AI Model → Response
                  ↑                            │
                  └────────────────────────────┘
                       (loop until complete)
```

This loop continues until the model has enough information to respond (max 10 iterations).

### 2. Integration Modules

Each integration is a self-contained module in `src/lib/integrations/<name>/`:

```
src/lib/integrations/salesforce/
├── client.ts    # API client (auth, HTTP requests)
├── tools.ts     # AI SDK tool definitions
└── index.ts     # Integration manifest (name, capabilities, isConfigured)
```

Integrations are auto-discovered: if the required env vars are set, the integration loads. If not, it's invisible to the AI.

### 3. Tools as AI SDK Functions

Every tool uses the Vercel AI SDK `tool()` format:

```typescript
import { tool } from 'ai'
import { z } from 'zod'

export const myTools = {
  doSomething: tool({
    description: 'What this tool does',
    inputSchema: z.object({
      param: z.string().describe('What this param means'),
    }),
    execute: async ({ param }) => {
      try {
        const result = await client.doSomething(param)
        return { success: true as const, data: result }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }),
}
```

Tools:
- Use Zod schemas for input validation (`inputSchema`, NOT `parameters`)
- Return `{ success: true/false, ... }` objects
- Handle their own errors (never throw)
- Are stateless — no side effects beyond their stated purpose

### 4. Multi-Interface Support

The same tools are used across interfaces:
- **CLI** (`cli.ts`) — local development and testing
- **Slack** (`/api/slack/route.ts`) — production interface
- **Web** (`/api/agent/route.ts`) — API endpoint

Each interface may have different:
- System prompts (Slack mentions formatting, CLI is concise)
- Response handling (Slack uploads files, CLI streams text)
- Permission checks (Slack looks up user identity)

## Code Organization

```
src/
├── app/
│   ├── page.tsx                # Landing page
│   ├── layout.tsx              # Root layout
│   ├── globals.css             # Global styles
│   ├── docs/[slug]/page.tsx    # Documentation pages
│   └── api/
│       ├── agent/route.ts      # CLI/API endpoint
│       ├── slack/route.ts      # Slack event handler
│       └── integrations/       # OAuth callbacks
├── lib/
│   ├── ai.ts                   # AI model configuration
│   ├── agent-config.ts         # System prompt assembly
│   ├── tools.ts                # Tool registry
│   ├── slack.ts                # Slack API utilities
│   └── integrations/
│       ├── index.ts            # Integration loader
│       ├── types.ts            # Integration interface
│       ├── salesforce/         # Salesforce module
│       ├── linear/             # Linear module
│       └── github/             # GitHub module
cli.ts                          # CLI interface
AGENTS.md                       # This file
```

## Adding New Integrations

See [docs/adding-integrations.md](docs/adding-integrations.md) for a complete step-by-step guide.

The short version:

1. Create `src/lib/integrations/<name>/client.ts` — API client
2. Create `src/lib/integrations/<name>/tools.ts` — AI SDK tools
3. Create `src/lib/integrations/<name>/index.ts` — Integration manifest
4. Register in `src/lib/integrations/index.ts`
5. Add env vars to `.env.local`

## Key Patterns

### Error Handling

Tools should never throw. Always return structured results:

```typescript
try {
  const data = await client.fetchData(input)
  return { success: true as const, data }
} catch (error) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : 'Unknown error',
  }
}
```

### Permission Checks

Destructive operations (delete, bulk update) check `ADMIN_SLACK_USER_IDS`:

```typescript
if (action === 'delete' && !isAdmin) {
  return { success: false, error: 'Permission denied' }
}
```

### Slack Formatting

Claude's output goes to Slack, which uses mrkdwn (not markdown):
- Bold: `*text*` (not `**text**`)
- No headers (use bold on its own line)
- Code blocks work normally

The `markdownToSlack()` function in `src/lib/slack.ts` handles conversion.

### CSV Export

The pattern for CSV export:
1. Tool stores results in `ctx.queryResults`
2. After processing, check if user wanted CSV (`wantsCSV()`)
3. If yes, convert to CSV and upload via Slack API

### Dynamic System Prompt

The system prompt is assembled at request time based on which integrations are configured. If GitHub isn't configured, the prompt doesn't mention commits. The AI won't try to use tools that don't exist.

## Environment Variables

Required:
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key
- `AI_PROVIDER` — `anthropic` or `openai`
- `SLACK_BOT_TOKEN` — Slack bot token
- `SLACK_BOT_USER_ID` — Bot's user ID (for filtering its own messages)

Optional:
- `AI_GATEWAY_URL` — Override AI gateway (default: ai-gateway.vercel.sh)
- `AI_MODEL` — Override model (default: claude-sonnet-4-5-20250929)
- `SALESFORCE_*` — Salesforce OAuth credentials
- `LINEAR_API_KEY` — Linear API key
- `LINEAR_TEAM_NAME` — Linear team identifier
- `GITHUB_TOKEN` — GitHub personal access token
- `GITHUB_REPO` — GitHub repo in `owner/repo` format
- `ADMIN_SLACK_USER_IDS` — Comma-separated Slack user IDs with admin access

## Future Considerations

### Workflow Engine
Multi-step processes that span systems and need human approval: workflow definitions, state persistence, approval handling in Slack.

### Observability
Structured logging for all tool calls, duration tracking, error rates by tool, usage patterns.

### More Integrations
HubSpot, Marketo, Google Analytics, Mixpanel, Notion — the integration system is designed to make adding these straightforward.

## Philosophy

When making changes, consider:

1. **Composability over features** — Will this work well with other tools?
2. **Simplicity over cleverness** — Can someone understand this in 30 seconds?
3. **Platform over point solution** — Does this strengthen the whole system?
4. **User intent over literal requests** — What is the user actually trying to accomplish?

The goal is a system where adding new capabilities is easy and the whole becomes greater than the sum of its parts.
