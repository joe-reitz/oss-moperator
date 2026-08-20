/**
 * AI enrichment for Linear issues.
 *
 * Turns "the pricing form drops UTMs" into a real issue with a title, a
 * markdown body, a priority, and labels. This is a plain `generateObject` call
 * rather than an agent turn on purpose: it is one deterministic extraction, so
 * it does not need tools, history, or the durable harness.
 *
 * The model id is a Vercel AI Gateway string, the same routing the agent uses,
 * so there is one credential (`AI_GATEWAY_API_KEY`) and no provider SDK here.
 */

import { generateObject } from "ai"
import { z } from "zod"

/** A small, fast model is plenty for structured extraction. */
const ENRICHMENT_MODEL =
  process.env.MOPERATOR_ENRICHMENT_MODEL || "anthropic/claude-haiku-4.5"

export interface EnrichedIssue {
  title: string
  description: string
  priority: number
  labelSuggestions: string[]
  issueType: "bug" | "feature"
}

const SYSTEM_PROMPT = `You are an issue triage assistant. Given a raw message, extract structured issue data.

Guidelines:
- title: A concise issue title (under 80 chars, imperative style)
- description: A clear description in markdown. Include the original message context.
- priority: 1=Urgent, 2=High, 3=Medium, 4=Low. Default to 3.
- labelSuggestions: 1-3 suggested label names.`

const enrichedIssueSchema = z.object({
  title: z.string().describe("Concise issue title, under 80 chars"),
  description: z.string().describe("Clear description in markdown"),
  priority: z.number().min(1).max(4).describe("1=Urgent, 2=High, 3=Medium, 4=Low"),
  labelSuggestions: z.array(z.string()).describe("1-3 suggested label names"),
})

export async function enrichIssueFromMessage(
  rawMessage: string,
  issueType: "bug" | "feature"
): Promise<EnrichedIssue> {
  try {
    const { object } = await generateObject({
      model: ENRICHMENT_MODEL,
      system: SYSTEM_PROMPT,
      prompt: `Issue type: ${issueType}\n\nRaw message:\n${rawMessage}`,
      schema: enrichedIssueSchema,
    })

    return { ...object, issueType }
  } catch (error) {
    console.error("[Linear] Enrichment failed, using fallback:", error)

    const fallbackTitle =
      issueType === "bug"
        ? `Bug: ${rawMessage.slice(0, 70)}`
        : `Feature: ${rawMessage.slice(0, 66)}`

    return {
      title: fallbackTitle,
      description: `${rawMessage}\n\n---\n_Reported via Slack_`,
      priority: issueType === "bug" ? 2 : 3,
      labelSuggestions: issueType === "bug" ? ["Bug"] : ["Feature"],
      issueType,
    }
  }
}
