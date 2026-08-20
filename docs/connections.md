# More capabilities

Two ways to extend mOperator beyond the integrations in the box, both cheaper than
writing a client:

- **Connections** wrap an external MCP or OpenAPI server. eve discovers its tools
  and brokers auth; the model never sees the URL or the credential.
- **Extensions** are packaged eve capabilities — tools, skills, hooks, subagents —
  installed from a registry.

Browse everything available with `npx eve registry list`, and inspect one before
installing with `npx eve registry view <name>`.

---

## Worth adding for marketing ops

These are the ones that actually change what a marketing ops agent can do.

| Add | What it unlocks |
| --- | --- |
| `npx eve add connection/notion` | Campaign briefs, content calendars, and the team wiki. The agent can read a brief and build the campaign from it. |
| `npx eve add connection/airtable` | Content calendars and campaign trackers, which is where a lot of marketing ops actually lives. |
| `npx eve add connection/posthog` | Product analytics. Closes the loop from campaign to signup to activation, which the CRM alone cannot answer. |
| `npx eve add connection/mixpanel` | Same, if that is your stack. |
| `npx eve add connection/stripe` | Revenue attribution against real payments rather than closed-won. |
| `npx eve add connection/bitly` | Short links and QR codes for print, events, and anywhere a UTM string will not fit. |
| `npx eve add connection/webflow` | The marketing site itself — pages, CMS collections, publishing. |
| `npx eve add extension/github-tools` | A fuller GitHub surface than the single commit reader here, with per-user OAuth and approval rules. |
| `npx eve add connection/linear` | Linear's own MCP server: cycles, projects, comments. Broader than the two typed tools in this repo. |

Connections are always on once the file exists, so only add what you want the
model reaching for. Delete `agent/connections/<name>.ts` to remove one.

## Memory across conversations

Out of the box, each Slack thread is its own session. If you want the agent to
remember things between conversations — "we always exclude test accounts", "our
Q1 target is X" — add a memory extension:

```bash
npx eve add extension/upstash-agentkit
```

This one is a natural fit because mOperator already uses Upstash Redis for
analytics and saved queries, so there is no new dependency. `extension/arcana` and
`extension/hindsight` are alternatives with different recall models.

Note the distinction from the audience vocabulary: the vocabulary is curated,
reviewed, and deliberately edited by a person at `/audience-vocab`. Memory is
accumulated automatically. For anything that decides which field a write targets,
prefer the vocabulary — you want that to be something a human approved.

## More places to reach it

The agent's logic is channel-independent, so adding a surface is one command:

```bash
npx eve add channel/teams       # Microsoft Teams
npx eve add channel/discord     # Discord
npx eve add channel/telegram    # Telegram
npx eve add channel/twilio      # SMS and voice
npx eve add channel/linear-agent  # delegate Linear issues to the agent directly
```

Each writes a file to `agent/channels/`. Copy the auth pattern from
`agent/channels/slack.ts` — specifically `authWithEmail` and `onInputResponse` —
because a new channel does **not** inherit Slack's approver gating. Without an
`onInputResponse` that checks the responder, anyone on that platform who can see
an approval prompt can answer it.

## Observability

Local traces are on by default: `npx eve traces` shows the span tree for the last
session, with token counts and cost. On Vercel, Agent Runs gives you the same per
deployment.

To export traces somewhere permanent, add one instrumentation provider:

```bash
npx eve add instrumentation/braintrust
npx eve add instrumentation/posthog
npx eve add instrumentation/datadog
npx eve add instrumentation/sentry
```

An agent has one `agent/instrumentation.ts`, so compose multiple exporters in that
file by hand rather than installing two.

This is separate from the `/analytics` dashboard. Tracing answers "what happened
inside that turn". The dashboard answers "who uses this and which tools earn their
keep" — see `agent/hooks/analytics.ts`.

## Writing a connection by hand

If a service has an MCP server that is not in the registry:

```ts
// agent/connections/braze.ts
import { defineMcpClientConnection } from "eve/connections"
import { once } from "eve/tools/approval"

export default defineMcpClientConnection({
  url: "https://mcp.braze.example/mcp",
  description: "Braze messaging: campaigns, canvases, user profiles.",
  auth: { getToken: async () => ({ token: process.env.BRAZE_API_KEY! }) },
  // Connection tools are not covered by this repo's approval policies, because
  // we did not author them. Gate the whole connection instead.
  approval: once(),
})
```

That last point matters. The policies in `agent/lib/approval.ts` only apply to
tools in `agent/tools/`. A connection brings in tools you did not write, and if
any of them can create, modify, delete, or send, set `approval` on the connection
— `once()` at minimum, `always()` for anything irreversible.

For OpenAPI services use `defineOpenAPIConnection` with a `spec` URL. Both are
documented at [eve.dev/docs/connections](https://eve.dev/docs/connections).

## Before you install anything

Registry items add dependencies and write files into your project. Inspect first
with `npx eve registry view <name>`, and read the diff before you run the agent.
Community skills from `@skills` are project files authored by other people —
treat them the way you would treat any dependency.
