/**
 * Linear provider.
 *
 * Adapts the existing `agent/lib/linear/client.ts` (built on @linear/sdk) onto
 * the shared tracker interface, so Linear is one option among several rather
 * than a special case with its own tools.
 *
 * Linear numbers priority 1-4 with 1 as most urgent, and 0 meaning "no
 * priority" — which is not the same as low, and is why the mapping below is
 * explicit rather than arithmetic.
 */

import * as linear from "../linear/client"
import {
  type CreateIssueInput,
  type QueryIssuesInput,
  type TrackerIssue,
  type TrackerPriority,
  type TrackerProject,
  type TrackerProvider,
} from "./types"

const PRIORITY_NUMBERS: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

function priorityFromNumber(value: number | undefined): TrackerPriority | undefined {
  switch (value) {
    case 1:
      return "urgent"
    case 2:
      return "high"
    case 3:
      return "medium"
    case 4:
      return "low"
    default:
      // 0 is "no priority", which is a real state in Linear and not a level.
      return undefined
  }
}

export const linearProvider: TrackerProvider = {
  id: "linear",
  name: "Linear",
  issueNoun: "issue",
  projectNoun: "team",
  requires: ["LINEAR_API_KEY"],

  isConfigured: () => !!process.env.LINEAR_API_KEY,

  async listProjects(): Promise<TrackerProject[]> {
    // The client is pinned to LINEAR_TEAM_NAME, so there is one container here.
    // Reporting it explicitly is more useful than an empty list, because it
    // tells the model which team its issues will land in.
    const teamKey = process.env.LINEAR_TEAM_NAME || "ENG"
    return [
      {
        id: teamKey,
        name: `${teamKey} (set by LINEAR_TEAM_NAME)`,
        kind: "team",
      },
    ]
  },

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const result = await linear.createIssue({
      title: input.title,
      description: input.description,
      priority: input.priority ? PRIORITY_NUMBERS[input.priority] : undefined,
      labelNames: input.labels,
    })

    const unsupported: string[] = []
    if (input.assignee) unsupported.push("assignee")
    if (input.dueDate) unsupported.push("due date")
    if (input.project && input.project !== (process.env.LINEAR_TEAM_NAME || "ENG")) {
      unsupported.push(
        `team "${input.project}" (this install is pinned to LINEAR_TEAM_NAME)`
      )
    }

    return {
      id: result.id,
      key: result.identifier,
      title: result.title,
      url: result.url,
      priority: priorityFromNumber(result.priority),
      labels: input.labels,
      note:
        unsupported.length > 0
          ? `Filed, but this Linear integration does not set: ${unsupported.join(", ")}.`
          : undefined,
    }
  },

  async queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]> {
    const issues = await linear.queryIssues({
      status: input.status,
      assignee: input.assignee,
      labelName: input.label,
      since: input.since,
      limit: input.limit,
    })

    const mapped: TrackerIssue[] = issues.map((issue) => ({
      id: issue.identifier,
      key: issue.identifier,
      title: issue.title,
      url: issue.url,
      status: issue.status,
      priority: priorityFromNumber(issue.priority),
      assignee: issue.assignee ?? undefined,
      labels: issue.labels,
      createdAt:
        issue.createdAt instanceof Date
          ? issue.createdAt.toISOString()
          : (issue.createdAt as string | undefined),
    }))

    // Linear's filter has no free-text title match, so search is applied here.
    if (input.search) {
      const needle = input.search.toLowerCase()
      return mapped.filter((issue) => issue.title.toLowerCase().includes(needle))
    }
    return mapped
  },
}
