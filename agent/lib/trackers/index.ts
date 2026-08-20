/**
 * The tracker registry.
 *
 * Which provider is active is an environment question, not a code question:
 * set `ASANA_ACCESS_TOKEN` and the tracker tools talk to Asana. Switching from
 * Asana to Jira is a credential change.
 *
 * Most teams configure exactly one. When more than one is configured, the tool
 * layer adds a `tracker` parameter listing only the active ones — see
 * `agent/tools/tracker.ts`. That way the common case has no extra parameter to
 * get wrong, and the uncommon case is still expressible.
 *
 * To add a provider: implement `TrackerProvider`, add it to `PROVIDERS`, and
 * document its variables. No tool changes.
 */

import { asanaProvider } from "./asana"
import { clickupProvider } from "./clickup"
import { jiraProvider } from "./jira"
import { linearProvider } from "./linear"
import { mondayProvider } from "./monday"
import type { TrackerProvider } from "./types"

export const PROVIDERS: TrackerProvider[] = [
  linearProvider,
  asanaProvider,
  jiraProvider,
  mondayProvider,
  clickupProvider,
]

export function activeProviders(): TrackerProvider[] {
  return PROVIDERS.filter((provider) => provider.isConfigured())
}

export function isTrackerConfigured(): boolean {
  return activeProviders().length > 0
}

/**
 * Pick the provider for this call.
 *
 * `MOPERATOR_TRACKER` decides when several are configured; otherwise the single
 * active one wins. An explicit id from the model always takes precedence, since
 * it only appears as a parameter when there is a genuine choice to make.
 */
export function resolveProvider(id?: string): TrackerProvider {
  const active = activeProviders()

  if (active.length === 0) {
    throw new Error(
      "No project tracker is configured. Set one of: " +
        PROVIDERS.map((provider) => `${provider.name} (${provider.requires.join(" + ")})`).join(
          ", "
        )
    )
  }

  if (id) {
    const match = active.find((provider) => provider.id === id)
    if (!match) {
      throw new Error(
        `"${id}" is not an active tracker. Active: ${active.map((p) => p.id).join(", ")}.`
      )
    }
    return match
  }

  const preferred = process.env.MOPERATOR_TRACKER?.trim().toLowerCase()
  if (preferred) {
    const match = active.find((provider) => provider.id === preferred)
    if (match) return match
    throw new Error(
      `MOPERATOR_TRACKER is set to "${preferred}", but that tracker is not configured. Active: ${active
        .map((p) => p.id)
        .join(", ")}.`
    )
  }

  return active[0]
}

/**
 * A line for the system prompt naming the active tracker and its vocabulary, so
 * the agent says "task" for Asana and "issue" for Jira rather than guessing.
 */
export function trackerSummary(): string | null {
  const active = activeProviders()
  if (active.length === 0) return null

  if (active.length === 1) {
    const provider = active[0]
    return `Project tracker: ${provider.name}. It calls a unit of work a "${provider.issueNoun}" and a container a "${provider.projectNoun}" — use its words when talking to people.`
  }

  const primary = resolveProvider()
  return (
    `Project trackers configured: ${active.map((p) => p.name).join(", ")}. ` +
    `${primary.name} is the default; pass \`tracker\` to use another. ` +
    `Ask which one someone means if a request is ambiguous.`
  )
}

export type { TrackerIssue, TrackerPriority, TrackerProject, TrackerProvider } from "./types"
