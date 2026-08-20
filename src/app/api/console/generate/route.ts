/**
 * POST /api/console/generate
 *
 * Translate a natural-language prompt into a SOQL query using the AI Gateway.
 * Uses the same audience vocabulary the Slack agent uses for marketer-term →
 * canonical-field mapping.
 */

import { NextRequest } from "next/server"
import { generateText } from "ai"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import { formatVocabularyForPrompt } from "@agent/lib/vocabulary"

/**
 * Same Vercel AI Gateway routing as the agent, so the console and the Slack
 * agent share one credential and one model choice.
 */
const SOQL_MODEL = process.env.AI_MODEL || "anthropic/claude-opus-4.8"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_PROMPT_LENGTH = 2000

const SYSTEM_PROMPT = `You are a Salesforce SOQL expert. The user describes what data they need; you return a single SELECT query that retrieves it.

Rules:
- Return ONLY the SOQL query — no explanation, no markdown fences, no commentary.
- The query MUST be a single SELECT statement. No INSERT/UPDATE/DELETE/UPSERT.
- Use the standard Salesforce object names (Contact, Lead, Account, Campaign, CampaignMember, Opportunity, Task, Event, etc.).
- For cross-object filters, use relationship syntax: "SELECT Contact.Email FROM CampaignMember WHERE Contact.Custom_Field__c = 'value'"
- Cap the result with LIMIT when the prompt suggests a small set (e.g., "top 10", "first 50"). For broad queries, omit LIMIT — the server will paginate.
- Use SFDC date literals where useful: TODAY, LAST_QUARTER, THIS_FISCAL_YEAR, LAST_N_DAYS:30, etc.
- When the prompt is ambiguous, make a reasonable guess and use comments inside the SELECT clause to flag assumptions if needed.
- If the prompt could be answered with a COUNT, prefer SELECT COUNT() FROM ... over SELECT Id and counting in the client.

Below is the curated marketer-term → canonical-field vocabulary for this org. Use these EXACT API names when the user references the listed terms. Do not invent fields.

{{VOCABULARY}}`

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
    const body = await req.json().catch(() => ({}))
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""

    if (!prompt) {
      return Response.json({ success: false, error: "Prompt is required" }, { status: 400 })
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return Response.json(
        { success: false, error: `Prompt exceeds ${MAX_PROMPT_LENGTH}-char limit` },
        { status: 400 }
      )
    }

    const vocabulary = (await formatVocabularyForPrompt()) || "(no curated vocabulary — use standard SFDC field names)"
    const system = SYSTEM_PROMPT.replace("{{VOCABULARY}}", vocabulary)

    const { text } = await generateText({
      model: SOQL_MODEL,
      system,
      messages: [{ role: "user", content: prompt }],
    })

    const cleaned = text
      .trim()
      .replace(/^```(?:soql|sql)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()

    return Response.json({ success: true, soql: cleaned })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
