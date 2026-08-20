/**
 * Linear tools.
 *
 * `file_linear_issue` used to hand the raw message to a second, smaller model
 * that wrote the title, body, priority, and labels. That model saw only the one
 * sentence — while the agent calling it had the whole Slack thread, the reporter,
 * and everything said before the request. The second model was strictly
 * worse-informed than the first.
 *
 * So the agent writes the issue now, and this tool files it. The description
 * below is the whole briefing: it is what turns "the pricing form is broken" into
 * an issue an engineer can act on.
 *
 * If you would rather use Linear's own MCP server for broader coverage (cycles,
 * projects, comments), run `eve add connection/linear`. See docs/connections.md.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { isConfigured } from "../lib/integrations"
import * as client from "../lib/linear/client"

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
          description: `File a bug, feature request, or task in Linear.

You write the issue, not the reporter. Take what they said, plus anything useful from the conversation, and turn it into something an engineer can pick up cold.

**title** — imperative and specific, under 80 characters. "Pricing page form drops UTM parameters", not "form bug" and not the reporter's sentence verbatim.

**description** — markdown. For a bug: what happens, what should happen, and how to reproduce it if that is known. For a feature: the underlying need, not the proposed solution. Quote the original report at the end so context is not lost, and name who reported it.

Never invent reproduction steps, error messages, or affected versions. If you do not know, say so in the issue — a guess sends someone down the wrong path.

**priority** — 1 Urgent (broken in production, losing money or data), 2 High (broken but there is a workaround), 3 Medium (the default; most things), 4 Low. Do not mark something Urgent because the reporter is annoyed; mark it Urgent because of impact.

**labels** — one to three. Only names that exist in the team; unmatched names are dropped silently, so prefer conventional ones over inventing.

Always include the returned URL in your reply.`,
          inputSchema: z.object({
            title: z
              .string()
              .max(120)
              .describe("Imperative, specific, under 80 characters"),
            description: z
              .string()
              .describe("Markdown body, including the original report"),
            kind: z
              .enum(["bug", "feature", "task"])
              .describe("What this is, used for labelling when no labels are given"),
            priority: z
              .number()
              .int()
              .min(1)
              .max(4)
              .optional()
              .describe("1 Urgent, 2 High, 3 Medium, 4 Low. Defaults to 3."),
            labels: z
              .array(z.string())
              .max(3)
              .optional()
              .describe("Existing Linear label names"),
          }),
          async execute({ title, description, kind, priority, labels }) {
            try {
              const result = await client.createIssue({
                title,
                description,
                priority: priority ?? (kind === "bug" ? 2 : 3),
                labelNames:
                  labels && labels.length > 0
                    ? labels
                    : [kind === "bug" ? "Bug" : "Feature"],
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
