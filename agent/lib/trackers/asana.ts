/**
 * Asana provider.
 *
 * REST API, personal access token. https://developers.asana.com/reference
 *
 * Two Asana-specific things worth knowing:
 *
 * 1. Asana has no built-in priority field. Most workspaces add a "Priority"
 *    custom field instead, so `createIssue` looks one up on the target project
 *    and sets it when the option names line up. When there is no such field the
 *    result says so rather than silently dropping the priority.
 *
 * 2. Asana notes are plain text, not markdown. `html_notes` accepts a limited
 *    HTML subset, but a marketing ops issue body is rarely worth the escaping
 *    risk, so descriptions go in as text.
 */

import {
  clamp,
  priorityFromName,
  type CreateIssueInput,
  type QueryIssuesInput,
  type TrackerIssue,
  type TrackerProject,
  type TrackerProvider,
} from "./types"

const BASE = "https://app.asana.com/api/1.0"

/** Fields worth asking for; Asana returns a minimal set otherwise. */
const TASK_FIELDS = [
  "name",
  "notes",
  "completed",
  "permalink_url",
  "created_at",
  "modified_at",
  "due_on",
  "assignee.name",
  "assignee.email",
  "projects.name",
  "tags.name",
  "custom_fields.name",
  "custom_fields.display_value",
].join(",")

interface AsanaTask {
  gid: string
  name: string
  completed?: boolean
  permalink_url?: string
  created_at?: string
  modified_at?: string
  assignee?: { name?: string; email?: string } | null
  projects?: Array<{ name?: string }>
  tags?: Array<{ name?: string }>
  custom_fields?: Array<{ name?: string; display_value?: string | null }>
}

function requireConfig() {
  const token = process.env.ASANA_ACCESS_TOKEN
  if (!token) {
    throw new Error(
      "Asana is not configured: set ASANA_ACCESS_TOKEN. See docs/setup-asana.md."
    )
  }
  return {
    token,
    workspace: process.env.ASANA_WORKSPACE_ID,
    defaultProject: process.env.ASANA_PROJECT_ID,
  }
}

async function asana<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = requireConfig()
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      ...init?.headers,
    },
  })

  const text = await response.text()
  if (!response.ok) {
    // Asana's own error text names the bad field, which is exactly what the
    // model needs to correct itself.
    throw new Error(`Asana ${response.status}: ${text.slice(0, 500)}`)
  }

  return (JSON.parse(text) as { data: T }).data
}

/** Asana wants a workspace for most listing and search calls. */
async function resolveWorkspace(): Promise<string> {
  const { workspace } = requireConfig()
  if (workspace) return workspace

  const workspaces = await asana<Array<{ gid: string; name: string }>>("/workspaces")
  if (workspaces.length === 0) {
    throw new Error("This Asana token can see no workspaces.")
  }
  if (workspaces.length > 1) {
    throw new Error(
      `This token can see ${workspaces.length} Asana workspaces. Set ASANA_WORKSPACE_ID to one of: ` +
        workspaces.map((entry) => `${entry.name} (${entry.gid})`).join(", ")
    )
  }
  return workspaces[0].gid
}

function toIssue(task: AsanaTask): TrackerIssue {
  const priorityField = task.custom_fields?.find((field) =>
    /priority/i.test(field.name ?? "")
  )

  return {
    id: task.gid,
    title: task.name,
    url: task.permalink_url ?? `https://app.asana.com/0/0/${task.gid}`,
    status: task.completed ? "Completed" : "Open",
    priority: priorityFromName(priorityField?.display_value ?? undefined),
    assignee: task.assignee?.name ?? task.assignee?.email ?? undefined,
    labels: task.tags?.map((tag) => tag.name).filter(Boolean) as string[] | undefined,
    project: task.projects?.[0]?.name,
    createdAt: task.created_at,
    updatedAt: task.modified_at,
  }
}

/**
 * Find a "Priority"-ish enum custom field on a project and the option matching
 * our semantic level. Returns null when the project has no such field, which is
 * the common case in a fresh workspace.
 */
async function resolvePriorityField(
  projectId: string,
  priority: string
): Promise<{ fieldGid: string; optionGid: string } | null> {
  interface Setting {
    custom_field?: {
      gid?: string
      name?: string
      resource_subtype?: string
      enum_options?: Array<{ gid: string; name: string; enabled?: boolean }>
    }
  }

  const settings = await asana<Setting[]>(
    `/projects/${projectId}/custom_field_settings?opt_fields=custom_field.name,custom_field.gid,custom_field.resource_subtype,custom_field.enum_options.name,custom_field.enum_options.gid,custom_field.enum_options.enabled`
  )

  for (const setting of settings) {
    const field = setting.custom_field
    if (!field?.gid || !field.name) continue
    if (!/priority/i.test(field.name)) continue
    if (field.resource_subtype !== "enum") continue

    const option = field.enum_options?.find(
      (candidate) =>
        candidate.enabled !== false &&
        priorityFromName(candidate.name) === priority
    )
    if (option) return { fieldGid: field.gid, optionGid: option.gid }
  }

  return null
}

export const asanaProvider: TrackerProvider = {
  id: "asana",
  name: "Asana",
  issueNoun: "task",
  projectNoun: "project",
  requires: ["ASANA_ACCESS_TOKEN"],

  isConfigured: () => !!process.env.ASANA_ACCESS_TOKEN,

  async listProjects(): Promise<TrackerProject[]> {
    const workspace = await resolveWorkspace()
    const projects = await asana<Array<{ gid: string; name: string; archived?: boolean }>>(
      `/projects?workspace=${workspace}&archived=false&opt_fields=name,archived&limit=100`
    )
    return projects.map((project) => ({
      id: project.gid,
      name: project.name,
      kind: "project",
      url: `https://app.asana.com/0/${project.gid}`,
    }))
  },

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const { defaultProject } = requireConfig()
    const projectId = input.project ?? defaultProject

    if (!projectId) {
      throw new Error(
        "Asana needs a project. Pass one, or set ASANA_PROJECT_ID as the default. Call list_tracker_projects to see the options."
      )
    }

    const data: Record<string, unknown> = {
      name: input.title,
      // Asana notes are plain text; markdown would render literally.
      notes: clamp(input.description, 65_000),
      projects: [projectId],
    }
    if (input.dueDate) data.due_on = input.dueDate
    if (input.assignee) data.assignee = input.assignee

    let priorityNote: string | undefined
    if (input.priority) {
      try {
        const resolved = await resolvePriorityField(projectId, input.priority)
        if (resolved) {
          data.custom_fields = { [resolved.fieldGid]: resolved.optionGid }
        } else {
          priorityNote = `This Asana project has no enum "Priority" custom field with a matching option, so priority "${input.priority}" was not set.`
        }
      } catch {
        // A permissions or shape problem reading custom fields must not stop the
        // task being filed — that is the part the user actually asked for.
        priorityNote = `Could not read the project's custom fields, so priority "${input.priority}" was not set.`
      }
    }

    const task = await asana<AsanaTask>("/tasks?opt_fields=" + TASK_FIELDS, {
      method: "POST",
      body: JSON.stringify({ data }),
    })

    const issue = toIssue(task)
    return priorityNote ? { ...issue, note: priorityNote } : issue
  },

  async queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]> {
    const { defaultProject } = requireConfig()
    const limit = Math.min(input.limit ?? 50, 100)

    // Search covers free text and the wider filters; a project listing is
    // cheaper and more reliable when all we need is "what is in this project".
    if (input.search || (!input.project && !defaultProject)) {
      const workspace = await resolveWorkspace()
      const params = new URLSearchParams({
        opt_fields: TASK_FIELDS,
        limit: String(limit),
      })
      if (input.search) params.set("text", input.search)
      if (input.project ?? defaultProject) {
        params.set("projects.any", String(input.project ?? defaultProject))
      }
      if (input.since) params.set("created_at.after", input.since)
      if (input.status?.toLowerCase() === "completed") params.set("completed", "true")
      if (input.status && input.status.toLowerCase() !== "completed") {
        params.set("completed", "false")
      }

      const tasks = await asana<AsanaTask[]>(
        `/workspaces/${workspace}/tasks/search?${params}`
      )
      return tasks.map(toIssue)
    }

    const params = new URLSearchParams({
      project: String(input.project ?? defaultProject),
      opt_fields: TASK_FIELDS,
      limit: String(limit),
    })
    if (input.status?.toLowerCase() === "completed") params.set("completed_since", "now")

    const tasks = await asana<AsanaTask[]>(`/tasks?${params}`)

    let issues = tasks.map(toIssue)
    if (input.since) {
      issues = issues.filter((issue) => !issue.createdAt || issue.createdAt >= input.since!)
    }
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
    return issues
  },

  async addComment(issueId: string, body: string): Promise<void> {
    await asana(`/tasks/${issueId}/stories`, {
      method: "POST",
      body: JSON.stringify({ data: { text: clamp(body, 65_000) } }),
    })
  },

  async setStatus(issueId: string, status: string): Promise<void> {
    // Asana models done-ness as a boolean, not a status list. Section moves are
    // a different API and a different concept, so keep this honest and narrow.
    const lower = status.toLowerCase()
    const completed = ["completed", "complete", "done", "closed"].includes(lower)
    if (!completed && !["open", "incomplete", "todo", "to do"].includes(lower)) {
      throw new Error(
        `Asana tasks are either complete or not. Use "completed" or "open", not "${status}". To move a task between sections, do it in Asana.`
      )
    }
    await asana(`/tasks/${issueId}`, {
      method: "PUT",
      body: JSON.stringify({ data: { completed } }),
    })
  },

  async listStatuses(): Promise<string[]> {
    return ["open", "completed"]
  },
}
