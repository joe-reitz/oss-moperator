/**
 * POST /api/console/generate
 *
 * Turn a natural-language prompt from the SOQL console into a query.
 *
 * This used to be a second SOQL brain: its own system prompt, its own copy of
 * the vocabulary injection, its own model choice — a parallel implementation
 * that drifted from the agent every time someone improved one and not the other.
 * Worse, it had no tools, so its prompt literally told it to "make a reasonable
 * guess" at field names.
 *
 * Now it asks the agent. That means the console gets, for free:
 *
 *   - the `soql-authoring` skill, with the relationship-traversal and date-literal
 *     rules that took real debugging to write down
 *   - the audience vocabulary, from the same source as everywhere else
 *   - `describe_salesforce_object`, so it can *check* a field name instead of
 *     guessing at one
 *
 * The caller's session cookie is forwarded, so the agent runs as the signed-in
 * person rather than as an anonymous service — the same identity the Slack
 * agent would see.
 */

import { Client } from "eve/client"
import { NextRequest } from "next/server"
import { z } from "zod"

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import { validateReadOnlySoql } from "@agent/lib/soql"

export const dynamic = "force-dynamic"
/** An agent turn that inspects schema takes longer than a single completion. */
export const maxDuration = 300

const MAX_PROMPT_LENGTH = 2000

const generatedQuery = z.object({
  soql: z
    .string()
    .describe("The SOQL query, with no markdown fences and no commentary"),
  assumptions: z
    .array(z.string())
    .describe(
      "Anything you had to guess — an ambiguous term, a field you could not verify, a date range you inferred. Empty when the request was unambiguous."
    ),
})

const INSTRUCTION = `Write a single read-only SOQL query for the request below. This is for the SOQL console, so return the query itself — do not run it, and do not export anything.

Load the soql-authoring skill first. Verify every object and field name with describe_salesforce_object rather than guessing; that is the whole reason this goes through you instead of a bare completion. Consult the audience vocabulary for any marketer term.

Add a LIMIT only when the request implies a small set ("top 10", "a few examples"). Leave it off otherwise — the console paginates. Prefer SELECT COUNT() when the answer is a number.

Record anything you had to guess in "assumptions". An empty list means the request was unambiguous and every field name was verified.

Request:`

/** Same-origin base URL for the agent's routes, which withEve mounts here. */
function agentHost(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("host")
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return Response.json({ success: false, error: err.message }, { status: 401 })
    }
    throw err
  }

  try {
    const body = await req.json()
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : ""

    if (!prompt) {
      return Response.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      )
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return Response.json(
        { success: false, error: `Prompt exceeds ${MAX_PROMPT_LENGTH}-char limit` },
        { status: 400 }
      )
    }

    const client = new Client({
      host: agentHost(req),
      // Forward the admin session so the agent authenticates the actual person.
      headers: { cookie: req.headers.get("cookie") ?? "" },
    })

    const { response } = await client.sessions.create<z.infer<typeof generatedQuery>>({
      message: `${INSTRUCTION}\n\n${prompt}`,
      outputSchema: generatedQuery,
    })

    const result = await response.result()
    const soql = result.data?.soql?.trim()

    if (!soql) {
      return Response.json(
        {
          success: false,
          error:
            "The agent did not return a query. It may have needed a clarification — try being more specific about the object and the time range.",
        },
        { status: 502 }
      )
    }

    // The console runs whatever comes back, so re-validate here rather than
    // trusting the model. Same check the run and export routes apply.
    const check = validateReadOnlySoql(soql)
    if (!check.ok) {
      return Response.json(
        { success: false, error: `Generated a non-read-only query (${check.reason})` },
        { status: 502 }
      )
    }

    return Response.json({
      success: true,
      soql,
      assumptions: result.data?.assumptions ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
