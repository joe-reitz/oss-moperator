/**
 * ClickUp provider.
 *
 * REST API v2, personal API token. https://developer.clickup.com/docs
 *
 * ClickUp nests deeply — team (workspace) → space → folder → list → task — and
 * tasks are created against a **list**, so `CLICKUP_LIST_ID` is the setting that
 * matters. `listProjects` walks the hierarchy to find lists, including
 * folderless ones, which are easy to miss.
 *
 * Priority is 1-4 with 1 as most urgent, matching Linear rather than Jira.
 * Due dates are Unix milliseconds, not ISO strings.
 */

import {
  clamp,
  priorityFromName,
  type CreateIssueInput,
  type QueryIssuesInput,
  type TrackerIssue,
  type TrackerPriority,
  type TrackerProject,
  type TrackerProvider,
} from "./types"

const BASE = "https://api.clickup.com/api/v2"

const PRIORITY_NUMBERS: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

interface ClickUpTask {
  id: string
  name: string
  description?: string | null
  url?: string
  date_created?: string
  date_updated?: string
  status?: { status?: string } | null
  priority?: { priority?: string } | null
  assignees?: Array<{ username?: string; email?: string }>
  tags?: Array<{ name?: string }>
  list?: { name?: string }
}

function requireConfig() {
  const token = process.env.CLICKUP_API_TOKEN
  if (!token) {
    throw new Error(
      "ClickUp is not configured: set CLICKUP_API_TOKEN. See docs/setup-clickup.md."
    )
  }
  return {
    token,
    team: process.env.CLICKUP_TEAM_ID,
    defaultList: process.env.CLICKUP_LIST_ID,
  }
}

async function clickup<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = requireConfig()
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // ClickUp takes the token bare, with no Bearer prefix.
      authorization: token,
      "content-type": "application/json",
      ...init?.headers,
    },
  })

  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 400)
    try {
      const parsed = JSON.parse(text) as { err?: string; ECODE?: string }
      if (parsed.err) detail = `${parsed.err}${parsed.ECODE ? ` (${parsed.ECODE})` : ""}`
    } catch {
      // Not JSON; keep the truncated body.
    }
    throw new Error(`ClickUp ${response.status}: ${detail}`)
  }

  return text ? (JSON.parse(text) as T) : ({} as T)
}

async function resolveTeam(): Promise<string> {
  const { team } = requireConfig()
  if (team) return team

  const data = await clickup<{ teams?: Array<{ id: string; name: string }> }>("/team")
  const teams = data.teams ?? []
  if (teams.length === 0) throw new Error("This ClickUp token can see no workspaces.")
  if (teams.length > 1) {
    throw new Error(
      `This token can see ${teams.length} ClickUp workspaces. Set CLICKUP_TEAM_ID to one of: ` +
        teams.map((entry) => `${entry.name} (${entry.id})`).join(", ")
    )
  }
  return teams[0].id
}

function toIssue(task: ClickUpTask): TrackerIssue {
  return {
    id: task.id,
    title: task.name,
    url: task.url ?? `https://app.clickup.com/t/${task.id}`,
    status: task.status?.status,
    priority: priorityFromName(task.priority?.priority),
    assignee: task.assignees?.[0]?.username ?? task.assignees?.[0]?.email,
    labels: task.tags?.map((tag) => tag.name).filter(Boolean) as string[] | undefined,
    project: task.list?.name,
    // ClickUp returns Unix milliseconds as strings.
    createdAt: task.date_created
      ? new Date(Number(task.date_created)).toISOString()
      : undefined,
    updatedAt: task.date_updated
      ? new Date(Number(task.date_updated)).toISOString()
      : undefined,
  }
}

export const clickupProvider: TrackerProvider = {
  id: "clickup",
  name: "ClickUp",
  issueNoun: "task",
  projectNoun: "list",
  requires: ["CLICKUP_API_TOKEN"],

  isConfigured: () => !!process.env.CLICKUP_API_TOKEN,

  async listProjects(): Promise<TrackerProject[]> {
    const teamId = await resolveTeam()
    const spaces = await clickup<{ spaces?: Array<{ id: string; name: string }> }>(
      `/team/${teamId}/space?archived=false`
    )

    const projects: TrackerProject[] = []

    for (const space of spaces.spaces ?? []) {
      // Lists living directly in a space, with no folder. Easy to overlook, and
      // often where a marketing team actually keeps its work.
      const folderless = await clickup<{ lists?: Array<{ id: string; name: string }> }>(
        `/space/${space.id}/list?archived=false`
      )
      for (const list of folderless.lists ?? []) {
        projects.push({
          id: list.id,
          name: `${space.name} / ${list.name}`,
          kind: "list",
          url: `https://app.clickup.com/${teamId}/v/li/${list.id}`,
        })
      }

      const folders = await clickup<{
        folders?: Array<{ id: string; name: string; lists?: Array<{ id: string; name: string }> }>
      }>(`/space/${space.id}/folder?archived=false`)
      for (const folder of folders.folders ?? []) {
        for (const list of folder.lists ?? []) {
          projects.push({
            id: list.id,
            name: `${space.name} / ${folder.name} / ${list.name}`,
            kind: "list",
            url: `https://app.clickup.com/${teamId}/v/li/${list.id}`,
          })
        }
      }
    }

    return projects
  },

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const { defaultList } = requireConfig()
    const listId = input.project ?? defaultList

    if (!listId) {
      throw new Error(
        "ClickUp needs a list. Pass one, or set CLICKUP_LIST_ID as the default. Call list_tracker_projects to see the options."
      )
    }

    const body: Record<string, unknown> = {
      name: input.title,
      // ClickUp renders markdown in `markdown_description`.
      markdown_description: clamp(input.description, 60_000),
    }
    if (input.priority) body.priority = PRIORITY_NUMBERS[input.priority]
    if (input.labels?.length) body.tags = input.labels
    if (input.dueDate) {
      // Unix milliseconds, not ISO. Anchor to midday UTC so a timezone shift
      // cannot roll the date backwards a day.
      body.due_date = new Date(`${input.dueDate}T12:00:00Z`).getTime()
    }

    const task = await clickup<ClickUpTask>(`/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(body),
    })

    return toIssue(task)
  },

  async queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]> {
    const { defaultList } = requireConfig()
    const listId = input.project ?? defaultList

    if (!listId) {
      throw new Error("ClickUp needs a list to query. Pass one, or set CLICKUP_LIST_ID.")
    }

    const params = new URLSearchParams({ archived: "false", subtasks: "true" })
    if (input.status) params.append("statuses[]", input.status)
    if (input.since) {
      params.set("date_created_gt", String(new Date(input.since).getTime()))
    }

    const data = await clickup<{ tasks?: ClickUpTask[] }>(
      `/list/${listId}/task?${params}`
    )

    let issues = (data.tasks ?? []).map(toIssue)

    if (input.assignee) {
      const needle = input.assignee.toLowerCase()
      issues = issues.filter((issue) => issue.assignee?.toLowerCase().includes(needle))
    }
    if (input.label) {
      const needle = input.label.toLowerCase()
      issues = issues.filter((issue) =>
        issue.labels?.some((tag) => tag.toLowerCase() === needle)
      )
    }
    if (input.search) {
      const needle = input.search.toLowerCase()
      issues = issues.filter((issue) => issue.title.toLowerCase().includes(needle))
    }

    return issues.slice(0, Math.min(input.limit ?? 50, 100))
  },

  async addComment(issueId: string, body: string): Promise<void> {
    await clickup(`/task/${issueId}/comment`, {
      method: "POST",
      body: JSON.stringify({ comment_text: clamp(body, 60_000) }),
    })
  },

  async setStatus(issueId: string, status: string): Promise<void> {
    await clickup(`/task/${issueId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    })
  },

  async listStatuses(project?: string): Promise<string[]> {
    const { defaultList } = requireConfig()
    const listId = project ?? defaultList
    if (!listId) return []

    const list = await clickup<{ statuses?: Array<{ status?: string }> }>(
      `/list/${listId}`
    )
    return (list.statuses ?? [])
      .map((entry) => entry.status)
      .filter((status): status is string => !!status)
  },
}
