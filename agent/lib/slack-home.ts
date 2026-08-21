/**
 * The Slack App Home tab.
 *
 * Answers the question a new user actually has — "what can this thing do here?"
 * — without them having to guess a prompt. It shows what is connected on *this*
 * install, so the answer is true rather than aspirational: a workspace with no
 * Google Ads does not see ad examples.
 *
 * Rendered from the same integration registry that drives the system prompt, so
 * the home tab and the agent cannot disagree about what exists.
 */

import { config } from "./config"
import { activeIntegrations, inactiveIntegrations } from "./integrations"
import { trackerSummary } from "./trackers"

type Block = Record<string, unknown>

function section(text: string): Block {
  return { type: "section", text: { type: "mrkdwn", text } }
}

function context(text: string): Block {
  return { type: "context", elements: [{ type: "mrkdwn", text }] }
}

const divider: Block = { type: "divider" }

/**
 * Build the Home view.
 *
 * `recentActivity` is optional so the tab still renders on an install with no
 * Redis — the alternative was hiding the whole panel behind a dependency.
 */
export function buildHomeView(input: {
  recentActivity?: { turns: number; toolCalls: number; days: number }
} = {}): { type: "home"; blocks: Block[] } {
  const active = activeIntegrations()
  const inactive = inactiveIntegrations()
  const blocks: Block[] = []

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: config.botName, emoji: true },
  })
  blocks.push(
    context(
      config.orgName
        ? `Marketing operations agent for ${config.orgName}. Mention me in any channel, or DM me.`
        : "Marketing operations agent. Mention me in any channel, or DM me."
    )
  )
  blocks.push(divider)

  // ── What it can do here ───────────────────────────────────────────────────
  if (active.length === 0) {
    blocks.push(
      section(
        "*Nothing is connected yet.*\nI can still search the web and analyze files you send me, but I have no CRM or ad account to work in."
      )
    )
    blocks.push(
      context(
        `Set the credentials for whichever of these you use, then restart: ${inactive
          .map((entry) => entry.name)
          .join(", ")}.`
      )
    )
  } else {
    blocks.push(section("*Connected*"))
    for (const entry of active) {
      const detail =
        entry.id === "tracker" ? (trackerSummary()?.split(".")[0] ?? entry.description) : entry.description
      blocks.push(section(`:white_check_mark:  *${entry.name}* — ${detail}`))
    }

    // Examples are the actual affordance: people copy them.
    const examples = active.flatMap((entry) => entry.examples.slice(0, 2)).slice(0, 6)
    if (examples.length > 0) {
      blocks.push(divider)
      blocks.push(section("*Things people ask me*"))
      blocks.push(section(examples.map((example) => `> ${example}`).join("\n")))
    }
  }

  if (inactive.length > 0 && active.length > 0) {
    blocks.push(divider)
    blocks.push(
      context(
        `*Not connected:* ${inactive.map((entry) => entry.name).join(", ")}. I will tell you if you ask for one of these rather than pretending.`
      )
    )
  }

  // ── How writes work ───────────────────────────────────────────────────────
  blocks.push(divider)
  blocks.push(section("*Before I change anything*"))
  blocks.push(
    section(
      [
        `• Writes by ${config.approvers.writes.length > 0 ? "an approver" : "anyone"} go straight through; everyone else's wait for one.`,
        `• Bulk changes over ${config.limits.bulkApprovalThreshold} are always reviewed, and over ${config.limits.bulkMax.toLocaleString()} refused.`,
        "• Deletions and anything that emails real people always need a person.",
        "• Ad budget changes need someone on the spend list, every time.",
        "• Salesforce changes are recorded under *your* name, so you may be asked to sign in once.",
      ].join("\n")
    )
  )

  if (input.recentActivity && input.recentActivity.turns > 0) {
    blocks.push(divider)
    blocks.push(
      context(
        `Last ${input.recentActivity.days} days: ${input.recentActivity.turns} conversation(s), ${input.recentActivity.toolCalls} action(s).`
      )
    )
  }

  blocks.push(divider)
  blocks.push(
    context(
      "Add :bug: to any message and I will file it. Say `/new` in a thread to start over."
    )
  )

  return { type: "home", blocks }
}
