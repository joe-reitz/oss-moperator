# mOperator Architecture

This document explains how mOperator works under the hood. It's useful for understanding the system and troubleshooting issues.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Slack Workspace                          │
│  User: @mOperator show me active campaigns                  │
│  User: /moperator bug Dashboard is slow                     │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  v
┌─────────────────────────────────────────────────────────────┐
│                   mOperator Backend                         │
│  POST /api/slack          (for @mentions, DMs)              │
│  POST /api/slack/commands (for /slash commands)             │
│  POST /api/agent          (for CLI)                         │
└────────────────┬──────────────────────────────────────────┬─┘
                 │                                          │
                 v                                          v
            ┌────────────────────┐              ┌─────────────────┐
            │   Slack Handling   │              │  Integrations   │
            │  - Parse message   │              │  (Auto-Discovery)
            │  - Get context     │              │  - Salesforce   │
            │  - Thread history  │              │  - Linear       │
            │  - CSV export      │              │  - GitHub       │
            └────────┬───────────┘              │  - Custom       │
                     │                          └────────┬────────┘
                     v                                   │
            ┌────────────────────────────────────────────v──────┐
            │      AI Model (Claude / GPT-4o)                   │
            │  - Reads system prompt                            │
            │  - Has access to integration tools                │
            │  - Decides which tool to call                     │
            │  - Handles follow-up conversations                │
            └────────────────────────────────────────────────────┘
```

## Request Flow

### 1. Slack Receives the Message

User: `@mOperator show me active campaigns`

Slack sends `POST /api/slack` with:
```json
{
  "type": "event_callback",
  "event": {
    "type": "app_mention",
    "text": "<@U12345> show me active campaigns",
    "user": "U99999",
    "channel": "C12345",
    "thread_ts": "1234567890.123456"
  }
}
```

### 2. Extract Message and Context

`src/app/api/slack/route.ts`:
- Removes bot mention from text → `"show me active campaigns"`
- Extracts channel and thread
- Checks if CSV export is needed
- Checks if it's a Linear issue shortcut (`bug:`, `feature:`)
- Loads thread history for conversation context

### 3. Build Conversation History

If in a thread:
```typescript
[
  { role: "user", content: "show me campaigns from last month" },
  { role: "assistant", content: "I found 3 campaigns..." },
  { role: "user", content: "filter to just active ones" },
]
```

Key rule: **Consecutive messages from the same role must be merged**. This is an Anthropic API requirement.

### 4. Call AI Model with Tools

`src/app/api/agent/route.ts` and `src/lib/ai.ts`:

```typescript
await generateText({
  model: getAIModel(),          // Claude or GPT-4o
  system: SLACK_SYSTEM_PROMPT,  // Instructions + active integrations
  tools: getAllTools(),         // Salesforce, Linear, GitHub tools
  messages: [                   // User message + history
    { role: "user", content: "show me active campaigns" }
  ],
  onStepFinish: (step) => {
    // Capture query results for CSV export
  }
})
```

### 5. AI Decides Which Tool to Use

The system prompt says:
> "You have access to Salesforce, Linear, and GitHub integrations. Use the appropriate tool to answer the question."

The AI looks at the tools available:

**Active tools** (if `SALESFORCE_ACCESS_TOKEN` is set):
- `querySalesforce` — Run SOQL queries
- `manageSalesforceRecords` — Create/update/delete

**Active tools** (if `LINEAR_API_KEY` is set):
- `fileLinearIssue` — Create bug or feature request
- `queryLinearIssues` — Search issues

**Active tools** (if `GITHUB_TOKEN` is set):
- `getRepoCommits` — Fetch commits and releases

The AI calls the appropriate tool with parameters.

### 6. Tool Execution

Example: User asks "show me active campaigns"

1. AI calls `querySalesforce` with:
   ```json
   {
     "soql": "SELECT Name, Status, CreatedDate FROM Campaign WHERE Status='Active'"
   }
   ```

2. Salesforce tool (`src/lib/integrations/salesforce/tools.ts`):
   - Validates the SOQL query
   - Calls Salesforce API
   - Returns results:
   ```json
   {
     "success": true,
     "records": [
       { "Name": "Holiday Sale 2024", "Status": "Active", ... },
       { "Name": "New Year Campaign", "Status": "Active", ... }
     ]
   }
   ```

3. Results are captured in `onStepFinish()` for potential CSV export

### 7. AI Generates Response

The AI reads the tool results and generates a human-readable response:

```
I found 2 active campaigns:

1. **Holiday Sale 2024** — Created Dec 1
2. **New Year Campaign** — Created Dec 27

Would you like details on any of these?
```

### 8. Send Message Back to Slack

`src/lib/slack.ts` — `sendSlackMessage()`:
- Converts markdown to Slack format
- Sends response to the original channel/thread
- Posts a "thinking" message first (optional, for UX)

### 9. CSV Export (Optional)

If the user asked for CSV or used words like "export":

```typescript
if (wantsCSV(text) && result.records) {
  const csv = recordsToCSV(result.records)
  uploadSlackFile(channel, csv, 'export.csv')
}
```

`recordsToCSV()` converts array of records to CSV format and uploads via Slack API.

### 10. Respond with Delayed Response (Slash Commands)

For `/moperator bug`, the flow is different:

```typescript
// Immediate response (must be within 3 seconds)
return { response_type: "ephemeral", text: "Filing bug..." }

// Delayed response (posted minutes later via responseUrl)
waitUntil(async () => {
  const result = await fileIssueFromMessage(text, 'bug')
  await fetch(responseUrl, {
    method: "POST",
    body: JSON.stringify({
      response_type: "in_channel",
      text: `*Bug filed:* <${result.url}|${result.identifier}>`
    })
  })
})
```

This pattern uses Vercel's `waitUntil()` for background work.

## Integration Module System

Each integration is a self-contained module that mOperator discovers and loads dynamically.

### Integration Interface

`src/lib/integrations/types.ts`:

```typescript
export interface Integration {
  name: string                         // "Salesforce", "Linear"
  description: string                  // "CRM and data queries"
  capabilities: string[]               // What the AI can do
  examples: string[]                   // Sample prompts
  isConfigured: () => boolean          // Check env vars
  getTools: () => Record<string, Tool> // AI SDK tools
}
```

### Auto-Discovery

`src/lib/integrations/index.ts`:

```typescript
const ALL_INTEGRATIONS: Integration[] = [
  salesforceIntegration,  // Added manually in code
  linearIntegration,
  githubIntegration,
]

export function getActiveIntegrations(): Integration[] {
  return ALL_INTEGRATIONS.filter(i => i.isConfigured())
}
```

Only integrations with required env vars appear in the system prompt.

### Integration Lifecycle

1. **Load time:** Check all integrations' `isConfigured()`
2. **Tool registration:** Call `getTools()` on active integrations
3. **System prompt:** List capabilities of active integrations
4. **Runtime:** AI sees tools and calls them as needed

If you don't have `SALESFORCE_ACCESS_TOKEN` set, Salesforce tools never appear.

## Thread Context Handling

When a user replies in a thread, mOperator loads the conversation history:

`src/lib/slack.ts` — `getThreadHistory()`:

1. Fetch all messages in thread since a cutoff (last 50 messages)
2. For each message, identify the role (user or bot)
3. **Merge consecutive same-role messages** (Anthropic API requirement)
4. Return array of `{ role, content }` pairs

Example:

**Raw messages:**
```
[User] hi
[User] what's the status
[Bot] I'll check for you
[Bot] Here's the status...
[User] export this as csv
```

**After merging:**
```typescript
[
  { role: "user", content: "hi\n\nwhat's the status" },
  { role: "assistant", content: "I'll check for you\n\nHere's the status..." },
  { role: "user", content: "export this as csv" },
]
```

This ensures the AI model (which requires alternating roles) can read the full conversation.

## System Prompt

`src/lib/agent-config.ts`:

The system prompt is assembled dynamically:

```
You are mOperator, a Slack bot that helps marketing and sales teams...

[List of active integrations and their capabilities]

Salesforce (CRM queries):
- Query Salesforce with natural language
- Example: "show me active campaigns"

Linear (Issue tracking):
- File bugs and features
- Example: "bug: dashboard is slow"

[Instructions on CSV export, threading, etc.]
```

The key insight: **The system prompt changes based on what's configured**.

If GitHub isn't configured, the system prompt doesn't mention commit queries. The AI won't try to use tools that don't exist.

## CSV Export Mechanism

When a user asks for CSV or uses keywords like "export":

1. **Tool execution captures results:**
   ```typescript
   onStepFinish({ toolResults }) {
     for (const result of toolResults) {
       if (result.toolName === "querySalesforce") {
         ctx.queryResults = result.output.records
       }
     }
   }
   ```

2. **Convert to CSV:**
   ```typescript
   const csv = recordsToCSV(records)
   // Name,Status,CreatedDate
   // Campaign A,Active,2024-01-01
   // Campaign B,Active,2024-01-15
   ```

3. **Upload to Slack:**
   ```typescript
   await uploadSlackFile(channel, csv, 'export.csv', title, threadTs)
   ```

4. **Slack stores and displays** the file in the thread

CSV is capped at 10,000 rows to avoid performance issues.

## Slash Command Flow

Slash commands have a unique flow because they must respond within 3 seconds:

1. **User types:** `/moperator bug Dashboard spinner never stops`
2. **Slack sends:** `POST /api/slack/commands` with `command`, `text`, `user_id`, `response_url`
3. **Handler runs:**
   ```typescript
   async handler(ctx: CommandContext) {
     // Immediate response (required within 3 seconds)
     return {
       response_type: "ephemeral",
       text: "Filing bug report..."
     }

     // Background work (sent later via responseUrl)
     waitUntil(async () => {
       const result = await fileIssueFromMessage(text, 'bug')
       await fetch(responseUrl, {
         method: "POST",
         body: JSON.stringify({
           response_type: "in_channel",
           text: `*Bug filed:* <${result.url}|${result.identifier}>`
         })
       })
     })
   }
   ```

4. **Slack shows** ephemeral message immediately
5. **Handler processes** in background (up to 5 minutes on Vercel)
6. **Final message posted** via `responseUrl` after processing completes

This pattern is used for `/moperator bug` and `/moperator feature`.

## Error Handling

All tools return a structured format:

```typescript
{
  success: true | false,
  data?: any,
  error?: string,
  message?: string,
}
```

If a tool fails:

1. Return `{ success: false, error: "specific message" }`
2. AI reads the error and explains to user
3. **Never hallucinate data** — the system prompt forbids it
4. Log errors to console for debugging

Example:

**User:** "Show me contacts"
**Tool fails:** `{ success: false, error: "Query syntax error: invalid field" }`
**AI response:** "I tried to query contacts but got an error: invalid field. Try asking for just 'contacts' without specifying fields."

## Data Flow Diagram

```
Message arrives
    ↓
Parse (remove @mention, check for CSV keyword)
    ↓
Get thread history
    ↓
Call generateText() with tools
    ↓
AI decides which tool(s) to call
    ↓
Tool runs (Salesforce query, file Linear issue, etc.)
    ↓
AI reads results
    ↓
AI generates response
    ↓
Send Slack message
    ↓
If CSV: upload file
```

## Performance Considerations

1. **Tool caching:** Don't cache Salesforce queries (data changes)
2. **Timeout:** Stop after 10 tool calls to avoid long waits
3. **CSV limit:** 10,000 rows max to avoid memory issues
4. **Redis (optional):** Cache slash command state for reliability

## Deployment

1. **Local:** `npm run dev` starts Next.js dev server
2. **Vercel:** Deployed as serverless functions
   - `POST /api/slack` → Slack event handler
   - `POST /api/slack/commands` → Slash command handler
   - `POST /api/agent` → CLI endpoint

Each request is stateless; all state comes from Slack thread history or Redis.

## Key Files

- `src/app/api/slack/route.ts` — Main Slack event handler
- `src/app/api/slack/commands/route.ts` — Slash command handler
- `src/lib/ai.ts` — AI model configuration
- `src/lib/tools.ts` — Tool assembly
- `src/lib/slack.ts` — Slack API utilities
- `src/lib/integrations/` — Integration modules
- `src/lib/agent-config.ts` — System prompt

## Troubleshooting

### Bot doesn't respond
1. Check Slack event subscription URL is correct
2. Check `SLACK_BOT_TOKEN` is set
3. Check app logs in Vercel: `vercel logs`

### Tool says "not available"
1. Check env var is set (e.g., `SALESFORCE_ACCESS_TOKEN`)
2. Restart the app (`npm run dev` or redeploy to Vercel)
3. Verify in system prompt that tool is listed

### CSV export doesn't work
1. User must include keyword: "csv", "export", "download", "spreadsheet"
2. Query must return results (some integrations don't support CSV)
3. Check Slack token has `files:write` scope

### Thread history not working
1. Set `SLACK_BOT_USER_ID` in env vars
2. Without it, thread history is limited
3. Verify bot joined the channel/thread
