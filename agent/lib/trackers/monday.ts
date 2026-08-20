/**
 * monday.com provider.
 *
 * GraphQL API. https://developer.monday.com/api-reference/
 *
 * monday is the most structurally different of the trackers here, and the
 * differences are worth stating plainly rather than papering over:
 *
 * - Everything is a **board** with typed **columns**. There is no fixed status
 *   or priority field; a board has whatever columns someone made. So this
 *   adapter discovers the board's columns and matches by title — a column
 *   called "Status" or "Priority" gets used, and when there is none the result
 *   says the value was not applied.
 * - `column_values` on a mutation is a JSON string, not an object. Nesting JSON
 *   inside a GraphQL string is the usual source of monday integration bugs, so
 *   it goes through `JSON.stringify` twice by design.
 * - Item descriptions are not a field. Long text lives in a long-text column or
 *   in an update (a comment), so a description is posted as the first update.
 */

import {
  priorityFromName,
  type CreateIssueInput,
  type QueryIssuesInput,
  type TrackerIssue,
  type TrackerProject,
  type TrackerProvider,
} from "./types"

const ENDPOINT = "https://api.monday.com/v2"
/** Pinning the version keeps a monday API change from silently altering shapes. */
const API_VERSION = "2024-10"

interface MondayColumn {
  id: string
  title: string
  type: string
}

interface MondayItem {
  id: string
  name: string
  url?: string
  created_at?: string
  updated_at?: string
  column_values?: Array<{ id: string; text?: string | null; column?: { title?: string } }>
}

function requireConfig() {
  const token = process.env.MONDAY_API_TOKEN
  if (!token) {
    throw new Error(
      "monday.com is not configured: set MONDAY_API_TOKEN. See docs/setup-monday.md."
    )
  }
  return { token, defaultBoard: process.env.MONDAY_BOARD_ID }
}

async function monday<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { token } = requireConfig()
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      // monday takes a bare token, not a Bearer prefix.
      authorization: token,
      "content-type": "application/json",
      "api-version": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  })

  const payload = (await response.json()) as {
    data?: T
    errors?: Array<{ message: string }>
    error_message?: string
  }

  if (payload.errors?.length) {
    throw new Error(`monday.com: ${payload.errors.map((e) => e.message).join("; ")}`)
  }
  if (payload.error_message) {
    throw new Error(`monday.com: ${payload.error_message}`)
  }
  if (!response.ok || !payload.data) {
    throw new Error(`monday.com returned HTTP ${response.status}`)
  }

  return payload.data
}

/** Read a board's columns so we can match "Status" / "Priority" by title. */
async function boardColumns(boardId: string): Promise<MondayColumn[]> {
  const data = await monday<{ boards?: Array<{ columns?: MondayColumn[] }> }>(
    `query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type } } }`,
    { ids: [boardId] }
  )
  return data.boards?.[0]?.columns ?? []
}

function findColumn(columns: MondayColumn[], pattern: RegExp, type?: string) {
  return columns.find(
    (column) => pattern.test(column.title) && (!type || column.type === type)
  )
}

function valueByTitle(item: MondayItem, pattern: RegExp): string | undefined {
  const match = item.column_values?.find((value) =>
    pattern.test(value.column?.title ?? "")
  )
  return match?.text ?? undefined
}

function toIssue(item: MondayItem, boardName?: string): TrackerIssue {
  return {
    id: item.id,
    title: item.name,
    url: item.url ?? `https://monday.com/boards/_/pulses/${item.id}`,
    status: valueByTitle(item, /status|stage|state/i),
    priority: priorityFromName(valueByTitle(item, /priority|urgency/i)),
    assignee: valueByTitle(item, /person|owner|assignee/i),
    project: boardName,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

const ITEM_FIELDS = `
  id
  name
  url
  created_at
  updated_at
  column_values { id text column { title } }
`

export const mondayProvider: TrackerProvider = {
  id: "monday",
  name: "monday.com",
  issueNoun: "item",
  projectNoun: "board",
  requires: ["MONDAY_API_TOKEN"],

  isConfigured: () => !!process.env.MONDAY_API_TOKEN,

  async listProjects(): Promise<TrackerProject[]> {
    const data = await monday<{
      boards?: Array<{ id: string; name: string; state?: string }>
    }>(`query { boards(limit: 100, state: active) { id name state } }`)

    return (data.boards ?? []).map((board) => ({
      id: board.id,
      name: board.name,
      kind: "board",
      url: `https://monday.com/boards/${board.id}`,
    }))
  },

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const { defaultBoard } = requireConfig()
    const boardId = input.project ?? defaultBoard

    if (!boardId) {
      throw new Error(
        "monday.com needs a board. Pass one, or set MONDAY_BOARD_ID as the default. Call list_tracker_projects to see the options."
      )
    }

    const columns = await boardColumns(boardId)
    const columnValues: Record<string, unknown> = {}
    const skipped: string[] = []

    if (input.priority) {
      const column = findColumn(columns, /priority|urgency/i)
      if (column) {
        // A status/dropdown column takes a label; monday resolves it against the
        // column's configured options and errors on an unknown one.
        const label =
          input.priority === "urgent"
            ? "Critical"
            : input.priority.charAt(0).toUpperCase() + input.priority.slice(1)
        columnValues[column.id] = { label }
      } else {
        skipped.push(`priority (no Priority column on this board)`)
      }
    }

    if (input.dueDate) {
      const column = findColumn(columns, /date|due|deadline/i, "date")
      if (column) columnValues[column.id] = { date: input.dueDate }
      else skipped.push("due date (no date column on this board)")
    }

    const data = await monday<{ create_item?: MondayItem }>(
      `mutation ($boardId: ID!, $name: String!, $values: JSON) {
         create_item(board_id: $boardId, item_name: $name, column_values: $values, create_labels_if_missing: true) {
           ${ITEM_FIELDS}
         }
       }`,
      {
        boardId,
        name: input.title,
        // column_values is a JSON *string* — this is the step everyone gets wrong.
        values: Object.keys(columnValues).length > 0 ? JSON.stringify(columnValues) : undefined,
      }
    )

    const item = data.create_item
    if (!item) throw new Error("monday.com did not return the created item.")

    // Items have no description field, so the body becomes the first update.
    if (input.description) {
      try {
        await monday(
          `mutation ($itemId: ID!, $body: String!) {
             create_update(item_id: $itemId, body: $body) { id }
           }`,
          { itemId: item.id, body: input.description }
        )
      } catch {
        skipped.push("description (could not post it as an update)")
      }
    }

    const issue = toIssue(item)
    return skipped.length > 0
      ? {
          ...issue,
          note: `Created, but monday.com could not take: ${skipped.join("; ")}. monday boards only have the columns someone configured on them.`,
        }
      : issue
  },

  async queryIssues(input: QueryIssuesInput): Promise<TrackerIssue[]> {
    const { defaultBoard } = requireConfig()
    const boardId = input.project ?? defaultBoard

    if (!boardId) {
      throw new Error(
        "monday.com needs a board to query. Pass one, or set MONDAY_BOARD_ID."
      )
    }

    const data = await monday<{
      boards?: Array<{ name?: string; items_page?: { items?: MondayItem[] } }>
    }>(
      `query ($ids: [ID!], $limit: Int!) {
         boards(ids: $ids) {
           name
           items_page(limit: $limit) { items { ${ITEM_FIELDS} } }
         }
       }`,
      { ids: [boardId], limit: Math.min(input.limit ?? 50, 100) }
    )

    const board = data.boards?.[0]
    let issues = (board?.items_page?.items ?? []).map((item) => toIssue(item, board?.name))

    // monday's server-side filtering needs per-column rule objects, which
    // requires knowing the board's schema up front. Filtering the page here is
    // less clever but predictable across arbitrary boards.
    if (input.status) {
      const needle = input.status.toLowerCase()
      issues = issues.filter((issue) => issue.status?.toLowerCase() === needle)
    }
    if (input.assignee) {
      const needle = input.assignee.toLowerCase()
      issues = issues.filter((issue) => issue.assignee?.toLowerCase().includes(needle))
    }
    if (input.search) {
      const needle = input.search.toLowerCase()
      issues = issues.filter((issue) => issue.title.toLowerCase().includes(needle))
    }
    if (input.since) {
      issues = issues.filter((issue) => !issue.createdAt || issue.createdAt >= input.since!)
    }

    return issues
  },

  async addComment(issueId: string, body: string): Promise<void> {
    await monday(
      `mutation ($itemId: ID!, $body: String!) {
         create_update(item_id: $itemId, body: $body) { id }
       }`,
      { itemId: issueId, body }
    )
  },
}
