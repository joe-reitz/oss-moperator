/**
 * Project tracker tools — Linear, Asana, Jira, monday.com, or ClickUp.
 *
 * One tool surface over whichever tracker the team actually uses. Five separate
 * `file_asana_task` / `file_jira_issue` tools would make the model pick a tool
 * before it knows the answer, and would grow the prompt with every backend.
 *
 * This is where dynamic tools earn their keep twice over:
 *
 * 1. The tools only exist when a tracker is configured.
 * 2. The **schema adapts**. With one tracker there is no `tracker` parameter to
 *    get wrong; with several, it appears as an enum of exactly the active ones.
 *    And every description is written in the active provider's own vocabulary —
 *    "task" and "project" for Asana, "issue" and "project" for Jira, "item" and
 *    "board" for monday — so the model is not translating between its
 *    instructions and what the user sees on their screen.
 *
 * Optional capabilities are advertised only when some active provider actually
 * implements them, rather than offered everywhere and failing on the ones that
 * cannot.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { activeProviders, isTrackerConfigured, resolveProvider } from "../lib/trackers"

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

/** Pull the optional tracker id off an input whose shape varies by install. */
function chosen(input: unknown): string | undefined {
  return (input as { tracker?: string } | undefined)?.tracker
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isTrackerConfigured()) return null

      const active = activeProviders()
      const primary = resolveProvider()
      const multiple = active.length > 1

      // Only ask which tracker when there is something to ask.
      const trackerParam = multiple
        ? {
            tracker: z
              .enum(active.map((provider) => provider.id) as [string, ...string[]])
              .optional()
              .describe(
                `Which tracker to use. Defaults to ${primary.id}. Only pass it when the user named a specific tool.`
              ),
          }
        : {}

      // Say it in the provider's words, not ours.
      const noun = primary.issueNoun
      const container = primary.projectNoun
      const where = multiple
        ? `${active.map((provider) => provider.name).join(", ")} (default ${primary.name})`
        : primary.name

      const anyComments = active.some((provider) => !!provider.addComment)
      const anyStatus = active.some((provider) => !!provider.setStatus)
      const anyStatusList = active.some((provider) => !!provider.listStatuses)

      return {
        file_tracker_issue: defineTool({
          description: `File a ${noun} in ${where}.

You write it, not the reporter. Take what they said, plus context from the conversation, and produce something someone can pick up cold.

**title** — imperative and specific, under 80 characters. "Pricing page form drops UTM parameters", not "form bug" and not their sentence verbatim.

**description** — markdown. For a bug: what happens, what should happen, and how to reproduce it if known. For a request: the underlying need, not the proposed solution. Quote the original report and name who reported it, so context survives.

Never invent reproduction steps, error messages, or versions. Say what you do not know — a guess sends someone down the wrong path.

**priority** — urgent (broken in production, losing money or data), high (broken with a workaround), medium (the default), low. Impact decides this, not how annoyed the reporter is.

**${container}** — omit it to use the configured default. Call list_tracker_projects first if the user named one and you do not have its id.

Include the returned URL in your reply. If the result carries a \`note\`, tell the user — it means part of the request could not be applied.`,
          inputSchema: z.object({
            title: z
              .string()
              .max(200)
              .describe("Imperative, specific, under 80 characters"),
            description: z
              .string()
              .optional()
              .describe("Markdown body, including the original report"),
            priority: z
              .enum(["urgent", "high", "medium", "low"])
              .optional()
              .describe("Defaults to medium"),
            labels: z
              .array(z.string())
              .max(5)
              .optional()
              .describe("Existing label or tag names. Unknown ones may be dropped."),
            assignee: z
              .string()
              .optional()
              .describe("Email or display name. Not every tracker supports this."),
            due_date: z
              .string()
              .optional()
              .describe("ISO date, YYYY-MM-DD. Not every tracker supports this."),
            project: z
              .string()
              .optional()
              .describe(`The ${container} id. Omit for the configured default.`),
            ...trackerParam,
          }),
          async execute(input) {
            try {
              const provider = resolveProvider(chosen(input))
              const issue = await provider.createIssue({
                title: input.title,
                description: input.description,
                priority: input.priority,
                labels: input.labels,
                assignee: input.assignee,
                dueDate: input.due_date,
                project: input.project,
              })
              return { success: true as const, tracker: provider.name, ...issue }
            } catch (error) {
              return fail(error, "Failed to file it")
            }
          },
        }),

        query_tracker_issues: defineTool({
          description: `Find ${noun}s in ${where}. Every filter is optional; omit them all for the most recent.

Include URLs in your reply so people can click through. Call list_tracker_statuses first if you are filtering by status and do not know the valid names — status names are per-${container}, and a wrong one silently returns nothing rather than erroring.`,
          inputSchema: z.object({
            status: z.string().optional().describe("Status name"),
            assignee: z.string().optional().describe("Email or display name"),
            label: z.string().optional().describe("Label or tag name"),
            since: z.string().optional().describe("ISO 8601 — only created after this"),
            search: z.string().optional().describe("Free text matched against titles"),
            project: z
              .string()
              .optional()
              .describe(`The ${container} id. Omit for the configured default.`),
            limit: z.number().min(1).max(100).optional().describe("Default 50"),
            ...trackerParam,
          }),
          async execute(input) {
            try {
              const provider = resolveProvider(chosen(input))
              const issues = await provider.queryIssues({
                status: input.status,
                assignee: input.assignee,
                label: input.label,
                since: input.since,
                search: input.search,
                project: input.project,
                limit: input.limit,
              })
              return {
                success: true as const,
                tracker: provider.name,
                count: issues.length,
                issues,
              }
            } catch (error) {
              return fail(error, "Query failed")
            }
          },
        }),

        list_tracker_projects: defineTool({
          description: `List the ${container}s in ${where}, with their ids. Call this before filing into or querying a specific ${container} — ids are opaque and cannot be guessed from a name.`,
          inputSchema: z.object({ ...trackerParam }),
          async execute(input) {
            try {
              const provider = resolveProvider(chosen(input))
              const projects = await provider.listProjects()
              return {
                success: true as const,
                tracker: provider.name,
                kind: provider.projectNoun,
                count: projects.length,
                projects,
              }
            } catch (error) {
              return fail(error, "Failed to list them")
            }
          },
        }),

        ...(anyComments && {
          comment_on_tracker_issue: defineTool({
            description: `Add a comment to a ${noun} in ${where}. Use it to attach findings, a related record id, or an answer to a question raised on the ${noun} — not to repeat what is already in the description.`,
            inputSchema: z.object({
              issue_id: z
                .string()
                .describe(`The ${noun} id, as returned when it was filed or found`),
              body: z.string().describe("Markdown comment body"),
              ...trackerParam,
            }),
            async execute(input) {
              try {
                const provider = resolveProvider(chosen(input))
                if (!provider.addComment) {
                  return {
                    success: false as const,
                    error: `${provider.name} does not support comments through this integration.`,
                  }
                }
                await provider.addComment(input.issue_id, input.body)
                return {
                  success: true as const,
                  tracker: provider.name,
                  message: `Commented on ${input.issue_id}`,
                }
              } catch (error) {
                return fail(error, "Failed to comment")
              }
            },
          }),
        }),

        ...(anyStatus && {
          set_tracker_issue_status: defineTool({
            description: `Move a ${noun} to a different status in ${where}. Call list_tracker_statuses first — valid names are per-${container}, and some trackers only permit specific transitions from the current status.`,
            inputSchema: z.object({
              issue_id: z.string().describe(`The ${noun} id`),
              status: z.string().describe("The target status name"),
              ...trackerParam,
            }),
            async execute(input) {
              try {
                const provider = resolveProvider(chosen(input))
                if (!provider.setStatus) {
                  return {
                    success: false as const,
                    error: `${provider.name} does not support status changes through this integration.`,
                  }
                }
                await provider.setStatus(input.issue_id, input.status)
                return {
                  success: true as const,
                  tracker: provider.name,
                  message: `Moved ${input.issue_id} to ${input.status}`,
                }
              } catch (error) {
                return fail(error, "Failed to change status")
              }
            },
          }),
        }),

        ...(anyStatusList && {
          list_tracker_statuses: defineTool({
            description: `List the valid status names for a ${container} in ${where}. Use it before filtering a query by status or moving a ${noun}, so you use a name the tracker actually has.`,
            inputSchema: z.object({
              project: z
                .string()
                .optional()
                .describe(`The ${container} id. Omit for the configured default.`),
              ...trackerParam,
            }),
            async execute(input) {
              try {
                const provider = resolveProvider(chosen(input))
                if (!provider.listStatuses) {
                  return {
                    success: false as const,
                    error: `${provider.name} does not expose a status list through this integration.`,
                  }
                }
                const statuses = await provider.listStatuses(input.project)
                return { success: true as const, tracker: provider.name, statuses }
              } catch (error) {
                return fail(error, "Failed to list statuses")
              }
            },
          }),
        }),
      }
    },
  },
})
