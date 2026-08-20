/**
 * A common shape for project trackers.
 *
 * Marketing ops teams file work into whatever their company already uses —
 * Linear, Asana, Jira, monday.com, ClickUp — and the job is the same in all of
 * them: file something, find what is open, move it along. Giving the model five
 * near-identical `file_asana_task` / `file_jira_issue` tools would make it pick
 * a tool before it knows the answer, and would grow the prompt with every
 * backend added.
 *
 * So there is one tool surface (`agent/tools/tracker.ts`) over this interface,
 * and switching trackers is an environment variable rather than a code change.
 *
 * The abstraction is deliberately shallow. It covers what genuinely maps across
 * all five and nothing more — no sprints, no epics, no portfolios, because those
 * do not translate and pretending they do produces confident nonsense. If you
 * need Jira sprints, add a Jira-specific tool alongside this; that is the right
 * shape for something that only one backend has.
 */

/** Semantic priority. Each provider maps this onto its own scheme. */
export type TrackerPriority = "urgent" | "high" | "medium" | "low"

/** A container for work: a Linear team, Asana project, Jira project, monday board, ClickUp list. */
export interface TrackerProject {
  id: string
  name: string
  /** What this provider calls it, for use in replies. */
  kind: string
  url?: string
}

/** One unit of work, normalized. */
export interface TrackerIssue {
  id: string
  /** Human-facing identifier where the provider has one, e.g. ENG-421 or PROJ-17. */
  key?: string
  title: string
  url: string
  status?: string
  priority?: TrackerPriority
  assignee?: string
  labels?: string[]
  project?: string
  createdAt?: string
  updatedAt?: string
  /**
   * A provider-specific caveat about what it could not do — an Asana workspace
   * with no Priority field, say. Surfaced to the model so it can tell the user
   * rather than implying the whole request landed.
   */
  note?: string
}

export interface CreateIssueInput {
  title: string
  /** Markdown. Providers that cannot render it receive plain text. */
  description?: string
  /** Provider project/board/list id. Falls back to the provider's configured default. */
  project?: string
  priority?: TrackerPriority
  labels?: string[]
  /** Email or display name; providers resolve it as best they can. */
  assignee?: string
  /** ISO date, YYYY-MM-DD. */
  dueDate?: string
}

export interface QueryIssuesInput {
  project?: string
  status?: string
  assignee?: string
  label?: string
  /** ISO 8601; only issues created after this. */
  since?: string
  /** Free-text search over titles. */
  search?: string
  limit?: number
}

/**
 * What a provider must implement. `createIssue` and `queryIssues` are required —
 * they are the whole point. Everything else is optional, and the tool layer
 * advertises a capability only when the active provider actually has it, rather
 * than offering it and failing.
 */
export interface TrackerProvider {
  /** Stable id, used in env vars, tool params, and docs. */
  id: string
  /** Display name for prompts and replies. */
  name: string
  /** What this provider calls a unit of work: "issue", "task", "item". */
  issueNoun: string
  /** What it calls a container: "team", "project", "board", "list". */
  projectNoun: string

  /** Every required env var is present. */
  isConfigured(): boolean
  /** Env vars this provider needs, for a specific setup message. */
  requires: string[]

  listProjects(): Promise<TrackerProject[]>
  createIssue(input: CreateIssueInput): Promise<TrackerIssue>
  queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]>

  /** Post a comment. Omit when the provider integration does not support it. */
  addComment?(issueId: string, body: string): Promise<void>
  /** Move an issue to a named status. */
  setStatus?(issueId: string, status: string): Promise<void>
  /** Valid status names, so the model does not guess. */
  listStatuses?(project?: string): Promise<string[]>
}

/**
 * Normalize whatever a provider returns for priority back onto our four levels.
 * Providers number priority differently — Linear and ClickUp both use 1-4 with
 * 1 as most urgent, Jira uses names — so this lives per adapter.
 */
export function priorityFromName(value: string | undefined): TrackerPriority | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower.includes("urgent") || lower.includes("highest") || lower.includes("critical") || lower.includes("blocker")) {
    return "urgent"
  }
  if (lower.includes("high")) return "high"
  if (lower.includes("medium") || lower.includes("normal")) return "medium"
  if (lower.includes("low")) return "low"
  return undefined
}

/** Truncate a description for providers with tight field limits. */
export function clamp(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}
