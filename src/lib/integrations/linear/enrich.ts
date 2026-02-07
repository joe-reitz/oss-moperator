/**
 * AI enrichment for Linear issues
 * Uses AI SDK generateObject() to produce structured issue data from raw messages
 */

import { generateObject } from "ai"
import { z } from "zod"
import { getAIModel } from "@/lib/ai"

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
      model: getAIModel(),
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
