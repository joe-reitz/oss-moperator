# Adding an integration

Three files and one registry entry. The pattern is the same whether you are
adding Braze, Amplitude, Segment, or your own internal API.

Before you write any of it, check whether the service already has an MCP server —
if it does, a connection is a few lines instead of a client. See
[More capabilities](connections.md).

---

## The shape

```
agent/lib/braze/client.ts    the API client — auth, HTTP, error normalization
agent/tools/braze.ts         the tools the model sees, gated on configuration
agent/lib/integrations.ts    one entry so the prompt and gating know about it
```

## 1. The client

Keep it dumb: authentication, requests, and throwing useful errors. No AI
concepts, no approval logic. This is also the file the SOQL console and other
non-agent code can import, so it must not depend on the agent runtime.

```ts
// agent/lib/braze/client.ts
/**
 * Braze API client.
 *
 * One place for the base URL, the key, and error shaping. Tools stay thin.
 */

const BASE_URL = process.env.BRAZE_REST_ENDPOINT

function requireConfig(): { endpoint: string; apiKey: string } {
  const endpoint = process.env.BRAZE_REST_ENDPOINT
  const apiKey = process.env.BRAZE_API_KEY
  if (!endpoint || !apiKey) {
    throw new Error("Braze is not configured: set BRAZE_REST_ENDPOINT and BRAZE_API_KEY.")
  }
  return { endpoint, apiKey }
}

async function brazeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { endpoint, apiKey } = requireConfig()
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  })

  if (!response.ok) {
    // Include the body: an API's own error message is far more useful to the
    // model than "request failed", and it is what lets it correct itself.
    const body = await response.text()
    throw new Error(`Braze ${response.status}: ${body.slice(0, 500)}`)
  }

  return (await response.json()) as T
}

export async function listCampaigns(page = 0) {
  return brazeFetch<{ campaigns: Array<{ id: string; name: string }> }>(
    `/campaigns/list?page=${page}`
  )
}

export async function sendCampaign(campaignId: string, userIds: string[]) {
  return brazeFetch("/campaigns/trigger/send", {
    method: "POST",
    body: JSON.stringify({
      campaign_id: campaignId,
      recipients: userIds.map((id) => ({ external_user_id: id })),
    }),
  })
}
```

## 2. Register it

`agent/lib/integrations.ts` drives two things: whether the tools appear, and what
the system prompt says. The `capabilities` and `examples` are written for the
model, not for a README — they are what it reads to decide whether this
integration is relevant.

```ts
{
  id: "braze",
  name: "Braze",
  description: "Cross-channel messaging — campaigns, canvases, user profiles",
  capabilities: [
    "List campaigns and canvases with their IDs",
    "Look up a user profile by external id",
    "Trigger an API campaign for specific users (always requires approval)",
  ],
  examples: [
    "What Braze campaigns are live?",
    "Send the onboarding campaign to these 40 users",
  ],
  requires: ["BRAZE_REST_ENDPOINT", "BRAZE_API_KEY"],
  setupGuide: "docs/setup-braze.md",
}
```

`requires` is doing real work: it gates the tools, and it is what the agent
quotes back when someone asks for Braze on an install that has none.

## 3. The tools

One file, `agent/tools/<id>.ts`, returning a map of tools only when the
integration is configured. That gating is the point — the model never sees a tool
it cannot run, so it never promises work this install cannot do.

```ts
// agent/tools/braze.ts
import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { externalSendApproval } from "../lib/approval"
import * as braze from "../lib/braze/client"
import { isConfigured } from "../lib/integrations"

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("braze")) return null

      return {
        list_braze_campaigns: defineTool({
          description:
            "List Braze campaigns with their IDs and status. Call this before triggering anything, so you use the right campaign.",
          inputSchema: z.object({
            page: z.number().min(0).optional().describe("Zero-indexed page"),
          }),
          async execute({ page }) {
            try {
              return { success: true as const, ...(await braze.listCampaigns(page)) }
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        send_braze_campaign: defineTool({
          description: `Trigger a Braze API campaign for specific users. This SENDS — treat it as irreversible.

Before calling, state the campaign name, the exact user count, and what those people will receive. Always requires human approval, and cannot run from a scheduled task.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The Braze campaign ID"),
            user_ids: z
              .array(z.string())
              .min(1)
              .describe("External user IDs to send to"),
          }),
          approval: externalSendApproval(),
          async execute({ campaign_id, user_ids }) {
            try {
              await braze.sendCampaign(campaign_id, user_ids)
              return {
                success: true as const,
                message: `Triggered ${campaign_id} for ${user_ids.length} users`,
              }
            } catch (error) {
              return fail(error, "Failed to trigger campaign")
            }
          },
        }),
      }
    },
  },
})
```

Then confirm it landed:

```bash
npm run agent:info
```

---

## Rules that matter

**Pick the right approval policy.** They are in `agent/lib/approval.ts` and the
choice is not cosmetic:

| Policy | Use for |
| --- | --- |
| none | Reads. Anything that cannot change state. |
| `writeApproval()` | Ordinary single-record writes. |
| `bulkApproval(countFn)` | Anything touching a list. Pass a function that pulls the count out of your input shape, so the size limits apply. |
| `deleteApproval()` | Deletions. Always a human, never from a schedule. |
| `externalSendApproval()` | Anything reaching real people — email, SMS, push, a published page. |
| `spendApproval()` + `requireSpendApprover(ctx)` | Anything that moves money. Both halves: the gate, and the check at the moment of effect. |

Omitting `approval` means the tool runs unattended. That is correct for reads and
wrong for everything else.

**Never throw from `execute`.** Return `{ success: false, error }`. A thrown error
becomes a failed tool call the model cannot explain; a returned error is something
it can report or work around. Include the API's own message.

**Write descriptions for the model, not for a human reader.** The description is
the only thing standing between it and the wrong tool. Say when to use it, what
to call first, what the common mistake is. Look at
`agent/tools/salesforce.ts` — the `query_salesforce` description tells the model
to describe the object first, because a guessed field name is the top cause of
failure.

**Use snake_case for tool and parameter names.** It matches the built-ins and the
rest of this repo.

**Keep `execute` inline.** In a `defineDynamic` file, `execute` must be written
inline as shown. `execute: myHandler` works on the first step and then breaks when
the runtime replays it after a pause.

**Return paths, not payloads.** If a tool can produce a lot of rows, write them to
`/workspace` with `writeCsvToWorkspace` and return the path. The Slack channel
attaches the file automatically, and the model reasons about a summary instead of
burning context. `agent/tools/salesforce.ts` `export_salesforce_query` is the
reference.

**Shape what the model sees** with `toModelOutput` when a tool returns something
rich the channel needs but the model does not.

## Also worth doing

- Add the variables to `.env.example` with a comment saying what they do.
- Write `docs/setup-<service>.md` and link it from `setupGuide`.
- Add an eval under `evals/` for the one behavior you care about.
- Add a skill in `agent/skills/` if the integration has a procedure worth
  remembering — that is where "how we actually run a Braze send" belongs, not in
  the tool description.
