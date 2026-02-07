/**
 * Linear API Client
 *
 * Uses @linear/sdk for issue management.
 * Requires LINEAR_API_KEY and LINEAR_TEAM_NAME env vars.
 */

import { LinearClient } from "@linear/sdk"

let _client: LinearClient | null = null

function getClient(): LinearClient {
  if (_client) return _client

  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY not configured")
  }

  _client = new LinearClient({ apiKey })
  return _client
}

function getTeamKey(): string {
  return process.env.LINEAR_TEAM_NAME || "ENG"
}

/**
 * Get the team ID by key, paginating through all teams
 */
async function getTeamId(): Promise<string> {
  const client = getClient()
  const teamKey = getTeamKey()

  let hasMore = true
  let cursor: string | undefined

  while (hasMore) {
    const teams = await client.teams({
      first: 50,
      after: cursor || undefined,
    })

    for (const team of teams.nodes) {
      if (team.key === teamKey) {
        return team.id
      }
    }

    hasMore = teams.pageInfo.hasNextPage
    cursor = teams.pageInfo.endCursor ?? undefined
  }

  throw new Error(`Linear team with key "${teamKey}" not found`)
}

/**
 * Get the Triage state ID for the team
 */
async function getTriageStateId(): Promise<string> {
  const client = getClient()
  const teamId = await getTeamId()

  const states = await client.workflowStates({
    filter: {
      team: { id: { eq: teamId } },
      type: { eq: "triage" },
    },
  })

  if (states.nodes.length === 0) {
    // Fallback: find any "backlog" or first state
    const allStates = await client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
    })
    if (allStates.nodes.length === 0) {
      throw new Error("No workflow states found for team")
    }
    return allStates.nodes[0].id
  }

  return states.nodes[0].id
}

/**
 * Fuzzy-match label names against team labels
 */
async function matchLabels(
  labelNames: string[]
): Promise<string[]> {
  const client = getClient()
  const teamId = await getTeamId()

  const labels = await client.issueLabels({
    filter: { team: { id: { eq: teamId } } },
  })

  const matched: string[] = []
  for (const name of labelNames) {
    const lower = name.toLowerCase()
    const label = labels.nodes.find(
      (l) => l.name.toLowerCase() === lower
    )
    if (label) {
      matched.push(label.id)
    }
  }

  return matched
}

export interface CreateIssueInput {
  title: string
  description?: string
  priority?: number
  labelNames?: string[]
}

export async function createIssue(input: CreateIssueInput) {
  const client = getClient()
  const teamId = await getTeamId()
  const stateId = await getTriageStateId()

  const labelIds =
    input.labelNames && input.labelNames.length > 0
      ? await matchLabels(input.labelNames)
      : undefined

  const result = await client.createIssue({
    teamId,
    title: input.title,
    description: input.description,
    priority: input.priority || 3,
    stateId,
    labelIds,
  })

  const issue = await result.issue
  if (!issue) {
    throw new Error("Failed to create issue")
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    priority: issue.priority,
  }
}

export interface QueryIssuesInput {
  status?: string
  assignee?: string
  labelName?: string
  since?: string
  limit?: number
}

export async function queryIssues(input: QueryIssuesInput) {
  const client = getClient()
  const teamId = await getTeamId()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: any = {
    team: { id: { eq: teamId } },
  }

  if (input.status) {
    filter.state = { name: { eqFold: input.status } }
  }

  if (input.assignee) {
    filter.assignee = { displayName: { containsIgnoreCase: input.assignee } }
  }

  if (input.labelName) {
    filter.labels = { name: { eqFold: input.labelName } }
  }

  if (input.since) {
    filter.createdAt = { gte: new Date(input.since) }
  }

  const issues = await client.issues({
    filter,
    first: Math.min(input.limit || 50, 100),
    orderBy: client.constructor.name ? undefined : undefined, // keep default
  })

  return Promise.all(
    issues.nodes.map(async (issue) => {
      const state = await issue.state
      const assignee = await issue.assignee
      const labels = await issue.labels()

      return {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        status: state?.name || "Unknown",
        priority: issue.priority,
        assignee: assignee?.displayName || null,
        labels: labels.nodes.map((l) => l.name),
        createdAt: issue.createdAt,
      }
    })
  )
}
