/**
 * Jira Cloud provider.
 *
 * REST API v3 with Basic auth (email + API token).
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 *
 * Two Jira-specific things that trip people up:
 *
 * 1. **Descriptions are ADF, not text.** v3 takes Atlassian Document Format, a
 *    JSON tree. `toAdf` below converts paragraphs and bullet lists, which covers
 *    an issue body; richer markdown degrades to plain paragraphs rather than
 *    failing the call.
 *
 * 2. **Priority and issue-type names are per-project.** "High" and "Task" exist
 *    almost everywhere but are not guaranteed, and a wrong name is a 400. So a
 *    priority that Jira rejects is retried without it rather than losing the
 *    issue, and the result says what happened.
 */

import {
  priorityFromName,
  type CreateIssueInput,
  type QueryIssuesInput,
  type TrackerIssue,
  type TrackerPriority,
  type TrackerProject,
  type TrackerProvider,
} from "./types"

/** Our semantic levels mapped onto Jira's default priority scheme. */
const PRIORITY_NAMES: Record<TrackerPriority, string> = {
  urgent: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
}

interface JiraIssue {
  id: string
  key: string
  fields?: {
    summary?: string
    status?: { name?: string }
    priority?: { name?: string }
    assignee?: { displayName?: string; emailAddress?: string } | null
    labels?: string[]
    project?: { name?: string; key?: string }
    created?: string
    updated?: string
  }
}

function requireConfig() {
  const site = process.env.JIRA_SITE
  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_API_TOKEN
  if (!site || !email || !token) {
    throw new Error(
      "Jira is not configured: set JIRA_SITE, JIRA_EMAIL, and JIRA_API_TOKEN. See docs/setup-jira.md."
    )
  }
  // Accept "acme", "acme.atlassian.net", or the full URL.
  const host = site
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .includes(".")
    ? site.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${site}.atlassian.net`

  return {
    baseUrl: `https://${host}`,
    auth: Buffer.from(`${email}:${token}`).toString("base64"),
    defaultProject: process.env.JIRA_PROJECT_KEY,
    issueType: process.env.JIRA_ISSUE_TYPE || "Task",
  }
}

async function jira<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, auth } = requireConfig()
  const response = await fetch(`${baseUrl}/rest/api/3${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
      accept: "application/json",
      ...init?.headers,
    },
  })

  const text = await response.text()
  if (!response.ok) {
    // Jira puts the useful part in errorMessages / errors, and the raw body is
    // long. Pull the fields the model can act on.
    let detail = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text) as {
        errorMessages?: string[]
        errors?: Record<string, string>
      }
      const parts = [
        ...(parsed.errorMessages ?? []),
        ...Object.entries(parsed.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
      ]
      if (parts.length > 0) detail = parts.join("; ")
    } catch {
      // Not JSON; the truncated body is the best we have.
    }
    throw new Error(`Jira ${response.status}: ${detail}`)
  }

  return text ? (JSON.parse(text) as T) : ({} as T)
}

/**
 * Minimal markdown to Atlassian Document Format.
 *
 * Handles the two structures an issue body actually uses — paragraphs and
 * bullet lists. Anything else becomes a paragraph, which is lossy but readable
 * and never invalid.
 */
export function toAdf(markdown: string | undefined) {
  const text = (markdown ?? "").trim()
  if (!text) {
    return { type: "doc", version: 1, content: [] }
  }

  const content: Array<Record<string, unknown>> = []

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) continue

    const isBulletList = lines.every((line) => /^[-*+]\s+/.test(line))
    if (isBulletList) {
      content.push({
        type: "bulletList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: line.replace(/^[-*+]\s+/, "") }],
            },
          ],
        })),
      })
      continue
    }

    content.push({
      type: "paragraph",
      content: [{ type: "text", text: lines.join(" ") }],
    })
  }

  return { type: "doc", version: 1, content }
}

function toIssue(issue: JiraIssue, baseUrl: string): TrackerIssue {
  const fields = issue.fields ?? {}
  return {
    id: issue.id,
    key: issue.key,
    title: fields.summary ?? issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    status: fields.status?.name,
    priority: priorityFromName(fields.priority?.name),
    assignee: fields.assignee?.displayName ?? fields.assignee?.emailAddress ?? undefined,
    labels: fields.labels,
    project: fields.project?.name ?? fields.project?.key,
    createdAt: fields.created,
    updatedAt: fields.updated,
  }
}

/** Escape a value for embedding in a JQL string literal. */
function jql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export const jiraProvider: TrackerProvider = {
  id: "jira",
  name: "Jira",
  issueNoun: "issue",
  projectNoun: "project",
  requires: ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"],

  isConfigured: () =>
    !!(process.env.JIRA_SITE && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),

  async listProjects(): Promise<TrackerProject[]> {
    const { baseUrl } = requireConfig()
    const page = await jira<{
      values?: Array<{ id: string; key: string; name: string }>
    }>("/project/search?maxResults=100&orderBy=name")

    return (page.values ?? []).map((project) => ({
      id: project.key,
      name: `${project.name} (${project.key})`,
      kind: "project",
      url: `${baseUrl}/browse/${project.key}`,
    }))
  },

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const { baseUrl, defaultProject, issueType } = requireConfig()
    const projectKey = input.project ?? defaultProject

    if (!projectKey) {
      throw new Error(
        "Jira needs a project key. Pass one, or set JIRA_PROJECT_KEY as the default. Call list_tracker_projects to see the options."
      )
    }

    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary: input.title,
      issuetype: { name: issueType },
      description: toAdf(input.description),
    }
    if (input.labels?.length) {
      // Jira labels cannot contain spaces; it rejects the whole call if they do.
      fields.labels = input.labels.map((label) => label.replace(/\s+/g, "-"))
    }
    if (input.dueDate) fields.duedate = input.dueDate

    let note: string | undefined
    let created: { id: string; key: string }

    try {
      created = await jira<{ id: string; key: string }>("/issue", {
        method: "POST",
        body: JSON.stringify({
          fields: input.priority
            ? { ...fields, priority: { name: PRIORITY_NAMES[input.priority] } }
            : fields,
        }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // A project with a custom priority scheme rejects "Highest"/"Medium". File
      // the issue anyway — losing it over a priority name would be worse.
      if (input.priority && /priority/i.test(message)) {
        created = await jira<{ id: string; key: string }>("/issue", {
          method: "POST",
          body: JSON.stringify({ fields }),
        })
        note = `Jira rejected priority "${PRIORITY_NAMES[input.priority]}" for project ${projectKey}, so the issue was created without it. Check that project's priority scheme.`
      } else {
        throw error
      }
    }

    const full = await jira<JiraIssue>(
      `/issue/${created.key}?fields=summary,status,priority,assignee,labels,project,created,updated`
    )
    const issue = toIssue(full, baseUrl)
    return note ? { ...issue, note } : issue
  },

  async queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]> {
    const { baseUrl, defaultProject } = requireConfig()
    const clauses: string[] = []

    const projectKey = input.project ?? defaultProject
    if (projectKey) clauses.push(`project = "${jql(projectKey)}"`)
    if (input.status) clauses.push(`status = "${jql(input.status)}"`)
    if (input.label) clauses.push(`labels = "${jql(input.label)}"`)
    if (input.since) clauses.push(`created >= "${jql(input.since.slice(0, 10))}"`)
    if (input.search) clauses.push(`summary ~ "${jql(input.search)}"`)
    if (input.assignee) {
      // Jira resolves this against account id, email, or display name.
      clauses.push(`assignee = "${jql(input.assignee)}"`)
    }

    const where = clauses.length > 0 ? `${clauses.join(" AND ")} ` : ""
    const query = `${where}ORDER BY created DESC`

    // `/search/jql` is the supported endpoint; the older `/search` is deprecated.
    const page = await jira<{ issues?: JiraIssue[] }>("/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: query,
        maxResults: Math.min(input.limit ?? 50, 100),
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "labels",
          "project",
          "created",
          "updated",
        ],
      }),
    })

    return (page.issues ?? []).map((issue) => toIssue(issue, baseUrl))
  },

  async addComment(issueId: string, body: string): Promise<void> {
    await jira(`/issue/${issueId}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: toAdf(body) }),
    })
  },

  async setStatus(issueId: string, status: string): Promise<void> {
    // Jira moves issues through named transitions, not by setting a status
    // directly, so find the transition whose destination matches.
    const available = await jira<{
      transitions?: Array<{ id: string; name: string; to?: { name?: string } }>
    }>(`/issue/${issueId}/transitions`)

    const wanted = status.toLowerCase()
    const transition = (available.transitions ?? []).find(
      (candidate) =>
        candidate.to?.name?.toLowerCase() === wanted ||
        candidate.name.toLowerCase() === wanted
    )

    if (!transition) {
      const names = (available.transitions ?? [])
        .map((candidate) => candidate.to?.name ?? candidate.name)
        .join(", ")
      throw new Error(
        `No transition to "${status}" from this issue's current status. Available: ${names || "none"}.`
      )
    }

    await jira(`/issue/${issueId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transition.id } }),
    })
  },

  async listStatuses(project?: string): Promise<string[]> {
    const { defaultProject } = requireConfig()
    const projectKey = project ?? defaultProject
    if (!projectKey) return []

    const statuses = await jira<
      Array<{ statuses?: Array<{ name: string }> }>
    >(`/project/${projectKey}/statuses`)

    return Array.from(
      new Set(statuses.flatMap((type) => (type.statuses ?? []).map((s) => s.name)))
    )
  },
}
