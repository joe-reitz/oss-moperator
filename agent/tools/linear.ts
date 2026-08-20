/**
 * Linear tools.
 *
 * `file_linear_issue` keeps the AI enrichment this repo has always had: you say
 * "the pricing form drops UTMs" and it files a real issue with a written title,
 * a markdown body, a priority, and labels — rather than an issue titled after
 * whatever someone typed into Slack.
 *
 * If you would rather use Linear's own MCP server for broader coverage (cycles,
 * projects, comments), run `eve add connection/linear` and delete this file.
 * See docs/connections.md.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { isConfigured } from "../lib/integrations"
import * as client from "../lib/linear/client"
import { enrichIssueFromMessage } from "../lib/linear/enrich"

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("linear")) return null

      return {
        file_linear_issue: defineTool({
          description: `File a bug, feature request, or task in Linear from a plain description.

Pass the user's own words as \`report\` and let this tool write the title, body, priority, and labels — that is what it is for. Only set the explicit fields when the user has clearly dictated them.

Always include the returned URL in your reply so the user can click through.`,
          inputSchema: z.object({
            report: z
              .string()
              .describe("What the user said, in their words. The tool writes it up."),
            kind: z
              .enum(["bug", "feature"])
              .describe("bug for something broken, feature for something wanted"),
            title: z
              .string()
              .optional()
              .describe("Override the generated title. Usually leave this out."),
            description: z
              .string()
              .optional()
              .describe("Override the generated body. Usually leave this out."),
            priority: z
              .number()
              .min(1)
              .max(4)
              .optional()
              .describe("1=Urgent, 2=High, 3=Medium, 4=Low. Overrides the guess."),
            labels: z
              .array(z.string())
              .optional()
              .describe("Label names to apply. Overrides the guesses."),
          }),
          async execute({ report, kind, title, description, priority, labels }) {
            try {
              const enriched = await enrichIssueFromMessage(report, kind)
              const result = await client.createIssue({
                title: title ?? enriched.title,
                description: description ?? enriched.description,
                priority: priority ?? enriched.priority,
                labelNames: labels ?? enriched.labelSuggestions,
              })
              return { success: true as const, ...result }
            } catch (error) {
              return fail(error, "Failed to file the issue")
            }
          },
        }),

        query_linear_issues: defineTool({
          description:
            "Query issues in the Linear team. Every filter is optional; omit them all for the most recent issues. Include issue URLs in your reply.",
          inputSchema: z.object({
            status: z
              .string()
              .optional()
              .describe("Workflow state name, e.g. Triage or In Progress"),
            assignee: z.string().optional().describe("Assignee display name"),
            label: z.string().optional().describe("Label name"),
            since: z
              .string()
              .optional()
              .describe("ISO 8601 date — only issues created after this"),
            limit: z
              .number()
              .min(1)
              .max(100)
              .optional()
              .describe("Max results, default 50"),
          }),
          async execute({ status, assignee, label, since, limit }) {
            try {
              const issues = await client.queryIssues({
                status,
                assignee,
                labelName: label,
                since,
                limit,
              })
              return { success: true as const, count: issues.length, issues }
            } catch (error) {
              return fail(error, "Query failed")
            }
          },
        }),
      }
    },
  },
})
