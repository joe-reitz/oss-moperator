/**
 * Linear AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as client from "./client"
import { enrichIssueFromMessage } from "./enrich"

export const linearTools = {
  createLinearIssue: tool({
    description: `Create an issue in Linear. Use this when users want to file a bug report, feature request, or task.
IMPORTANT: Always include the issue URL in your response so the user can click through to Linear.`,
    inputSchema: z.object({
      title: z.string().describe("Concise issue title"),
      description: z.string().optional().describe("Detailed description in markdown"),
      priority: z.number().optional().describe("Priority: 1=Urgent, 2=High, 3=Medium, 4=Low"),
      labelNames: z.array(z.string()).optional().describe("Label names to apply"),
    }),
    execute: async ({ title, description, priority, labelNames }) => {
      try {
        const result = await client.createIssue({ title, description, priority, labelNames })
        return { success: true as const, ...result }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create issue" }
      }
    },
  }),

  queryLinearIssues: tool({
    description: `Query issues in the Linear team. All parameters are optional.
IMPORTANT: Always include issue URLs in your response.`,
    inputSchema: z.object({
      status: z.string().optional().describe("Status name to filter by (e.g. 'Triage', 'In Progress')"),
      assignee: z.string().optional().describe("Assignee display name"),
      labelName: z.string().optional().describe("Label name"),
      since: z.string().optional().describe("ISO 8601 date — only issues created after this date"),
      limit: z.number().optional().describe("Max results (default 50, max 100)"),
    }),
    execute: async ({ status, assignee, labelName, since, limit }) => {
      try {
        const issues = await client.queryIssues({ status, assignee, labelName, since, limit })
        return { success: true as const, count: issues.length, issues }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Query failed" }
      }
    },
  }),
}

/**
 * File an issue from a raw Slack message with AI enrichment.
 * Shared by slash commands and @mention shortcuts.
 */
export async function fileIssueFromMessage(
  rawMessage: string,
  issueType: "bug" | "feature"
): Promise<
  | { success: true; identifier: string; title: string; url: string }
  | { success: false; error: string }
> {
  try {
    const enriched = await enrichIssueFromMessage(rawMessage, issueType)

    const result = await client.createIssue({
      title: enriched.title,
      description: enriched.description,
      priority: enriched.priority,
      labelNames: enriched.labelSuggestions,
    })

    return {
      success: true,
      identifier: result.identifier,
      title: result.title,
      url: result.url,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to file issue",
    }
  }
}
