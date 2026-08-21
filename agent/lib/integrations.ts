/**
 * Integration registry.
 *
 * mOperator activates integrations from the environment: set the keys, get the
 * tools. Nothing to register in two places, and the model never sees a tool it
 * cannot actually run — which keeps it from confidently promising a Marketo
 * operation on an install that has no Marketo.
 *
 * Two consumers read this file:
 *
 *   - `agent/tools/<name>.ts` gates its tool map on `isConfigured()`
 *   - `agent/instructions/20-capabilities.ts` renders the active set into the
 *     system prompt at session start
 *
 * Adding an integration means adding an entry here, a `agent/lib/<name>/`
 * client, and a `agent/tools/<name>.ts` file. See docs/adding-integrations.md.
 */

import { config } from "./config"
import { trackerSummary } from "./trackers"

export interface IntegrationManifest {
  /** Stable id, matching the tool file name. */
  id: string
  /** Display name used in the system prompt. */
  name: string
  /** One line: what this integration is for. */
  description: string
  /** What the agent can do with it, written for the model. */
  capabilities: string[]
  /** Example prompts, shown to users when they ask what the agent can do. */
  examples: string[]
  /** Env vars that must all be set. Named so the setup error can be specific. */
  requires: string[]
  /**
   * Alternative credential sets: the integration is active when *any one* group
   * is fully set. Used by the project tracker, which is one capability backed by
   * a choice of five services.
   */
  anyOf?: string[][]
  /** Docs page for setup, relative to the repo root. */
  setupGuide?: string
}

export const INTEGRATIONS: IntegrationManifest[] = [
  {
    id: "salesforce",
    name: "Salesforce",
    description: "CRM system of record — accounts, contacts, leads, campaigns",
    capabilities: [
      "Run SOQL against any object, with full pagination for large result sets",
      "Inspect object schemas before writing a query",
      "Add contacts to campaigns and manage campaign membership",
      "Create, update, and delete records; bulk-update up to the configured cap",
      "Import a list: inspect it, dedupe against the CRM, then bulk-insert what is new",
      "Pull query results into the sandbox as CSV for analysis or export",
    ],
    examples: [
      "Show me active campaigns and their member counts",
      "Export every contact at Acme Corp as a CSV",
      "How many leads did we source from the webinar last quarter?",
      "Add these 40 contacts to campaign 701xx000000ABCD",
    ],
    requires: ["SALESFORCE_ACCESS_TOKEN", "SALESFORCE_INSTANCE_URL"],
    setupGuide: "docs/setup-salesforce.md",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM and marketing automation — contacts, companies, deals, lists",
    capabilities: [
      "Search contacts, companies, and deals",
      "Read and manage static list membership",
      "Create and update contacts, companies, and deals",
      "Look up record owners",
    ],
    examples: [
      "Find HubSpot contacts at companies over 500 employees",
      "What deals are closing this month?",
      "Add these contacts to the Q1 nurture list",
    ],
    requires: ["HUBSPOT_API_TOKEN"],
    setupGuide: "docs/setup-hubspot.md",
  },
  {
    id: "marketo",
    name: "Marketo",
    description: "Marketing automation — leads, lists, programs, email campaigns",
    capabilities: [
      "Search and read leads, and inspect the lead field schema",
      "Read list, program, campaign, and email inventories",
      "Create and update leads; manage static list membership",
      "Trigger request campaigns (always requires approval — this sends email)",
    ],
    examples: [
      "How many leads are in the Q1 webinar list?",
      "What programs are running right now?",
      "Add these leads to the nurture list",
    ],
    requires: [
      "MARKETO_CLIENT_ID",
      "MARKETO_CLIENT_SECRET",
      "MARKETO_REST_ENDPOINT",
    ],
    setupGuide: "docs/setup-marketo.md",
  },
  {
    id: "customerio",
    name: "Customer.io",
    description:
      "Behavioural messaging — people, segments, campaigns, broadcasts, transactional email",
    capabilities: [
      "Look up people by email, or search them with a filter",
      "List segments and read their membership",
      "Read campaigns and their delivery metrics over a date range",
      "Create and update people, and record events that can start campaigns",
      "Add and remove members of manual segments (needs the Track API credentials)",
      "Send transactional email, and fire API-triggered broadcasts — both always require approval",
    ],
    examples: [
      "Who is jane@acme.com in Customer.io and what plan are they on?",
      "How did the onboarding campaign perform over the last 30 days?",
      "Add these 40 people to the manual win-back segment",
    ],
    requires: ["CUSTOMERIO_APP_API_KEY"],
    setupGuide: "docs/setup-customerio.md",
  },
  {
    id: "iterable",
    name: "Iterable",
    description:
      "Cross-channel marketing automation — users, lists, campaigns, templates",
    capabilities: [
      "Look up users by email, with their fields and list subscriptions",
      "List lists and read their membership, and list campaigns and templates",
      "Read campaign metrics for one or many campaigns over a date range",
      "Create and update users singly or in bulk, chunked at Iterable's 1,000 limit",
      "Subscribe and unsubscribe people from static lists",
      "Send an existing campaign to one person — always requires approval",
    ],
    examples: [
      "How many people are on the Q1 nurture list in Iterable?",
      "Compare open rates across these three campaigns",
      "Add these contacts to list 12345",
    ],
    requires: ["ITERABLE_API_KEY"],
    setupGuide: "docs/setup-iterable.md",
  },
  {
    id: "inflection",
    name: "Inflection",
    description:
      "B2B marketing automation built on product and sales data — contacts, lists, activity",
    capabilities: [
      "Look up contacts by email or id",
      "Read a contact's marketing activity, product activity, or combined log",
      "Create and update contacts in batches of up to 1,000 (writes are asynchronous)",
      "Create lists, read their members, and add or remove membership",
    ],
    examples: [
      "What has jane@acme.com done in the product recently?",
      "Import these contacts into Inflection and add them to the launch list",
      "Show me the marketing activity for this contact",
    ],
    requires: ["INFLECTION_API_TOKEN"],
    setupGuide: "docs/setup-inflection.md",
  },
  {
    id: "google_ads",
    name: "Google Ads",
    description: "Paid search and display — campaigns, budgets, ad groups, creative",
    capabilities: [
      "List campaigns with spend, impressions, clicks, conversions, CTR, and CPC",
      "Pull performance over a date range, broken out by campaign",
      "Create campaigns (always PAUSED first), ad groups, and responsive search ads",
      "Change daily budgets and campaign status",
      "Every spend-affecting action requires approval from a spend approver",
    ],
    examples: [
      "How are our Google Ads performing this month?",
      "Which campaigns have the worst cost per conversion?",
      "Raise the budget on the brand campaign to $300/day",
    ],
    requires: [
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID",
    ],
    setupGuide: "docs/setup-google-ads.md",
  },
  {
    id: "tracker",
    name: "Project tracker",
    description:
      "Where work gets filed — Linear, Asana, Jira, monday.com, or ClickUp",
    capabilities: [
      "File a bug, request, or task with a written title, body, priority, and labels",
      "Find open work by status, assignee, label, or free text",
      "List the projects, boards, or lists available to file into",
      "Comment on an item, and move it between statuses",
    ],
    examples: [
      "Bug: the pricing page form drops UTM parameters",
      "What's sitting in triage right now?",
      "File a task to update the Q1 nurture copy, due Friday, high priority",
      "Show me everything filed this week",
    ],
    requires: [],
    anyOf: [
      ["LINEAR_API_KEY"],
      ["ASANA_ACCESS_TOKEN"],
      ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"],
      ["MONDAY_API_TOKEN"],
      ["CLICKUP_API_TOKEN"],
    ],
    setupGuide: "docs/setup-project-tracker.md",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Shipping activity on the marketing site or product repo",
    capabilities: ["Read recent commits on a branch, with authors and dates"],
    examples: [
      "What shipped on the marketing site this week?",
      "Summarize the last 20 commits for the newsletter",
    ],
    requires: ["GITHUB_TOKEN", "GITHUB_REPO"],
    setupGuide: "docs/setup-github.md",
  },
  {
    id: "knak",
    name: "Knak",
    description: "On-brand email and landing-page builder wired to your design system",
    capabilities: [
      "Build an on-brand email from approved copy, reproduced verbatim",
      "Build one from a description when no copy exists yet, letting Knak write it",
      "Browse brands, campaigns (asset folders), and themes",
      "Pull an asset's rendered HTML to QA links, UTMs, subject, and preheader",
      "Apply the org's asset naming convention, which Knak cannot change after creation",
    ],
    examples: [
      "Build the AI Gateway launch email — here's the approved copy",
      "Make me a newsletter for the March product roundup",
      "QA the links on the webinar invite before it goes out",
    ],
    requires: ["KNAK_API_KEY"],
    setupGuide: "docs/setup-knak.md",
  },
  {
    id: "luma",
    name: "Luma",
    description: "Event registration pages with compliance questions baked in",
    capabilities: [
      "Create Luma events with the required registration questions pre-attached",
      "Add a data-sharing opt-in automatically when a co-organizer is involved",
      "Stamp the created event id onto a linked Salesforce campaign",
    ],
    examples: [
      "Create a Luma event for our Austin dinner on March 12 at 6pm",
      "Set up a webinar registration page for the observability launch",
    ],
    requires: ["LUMA_API_KEY"],
    setupGuide: "docs/setup-luma.md",
  },
]

/** Configured when every var in `requires` is set, or any `anyOf` group is. */
export function isConfigured(id: string): boolean {
  const manifest = INTEGRATIONS.find((entry) => entry.id === id)
  if (!manifest) return false

  if (manifest.anyOf?.length) {
    return manifest.anyOf.some((group) => group.every((key) => !!process.env[key]))
  }
  return manifest.requires.length > 0
    ? manifest.requires.every((key) => !!process.env[key])
    : false
}

/** Which env vars are missing, for a specific setup error. */
export function missingEnv(id: string): string[] {
  const manifest = INTEGRATIONS.find((entry) => entry.id === id)
  if (!manifest) return []

  if (manifest.anyOf?.length) {
    // Report the group the operator was most likely trying to configure: the one
    // with the most variables already set. Ranking purely by fewest-missing gets
    // this wrong — someone who has set JIRA_SITE and nothing else should be told
    // about JIRA_EMAIL and JIRA_API_TOKEN, not that Linear needs one variable.
    const ranked = manifest.anyOf
      .map((group) => ({
        set: group.filter((key) => !!process.env[key]).length,
        missing: group.filter((key) => !process.env[key]),
      }))
      .sort((a, b) => b.set - a.set || a.missing.length - b.missing.length)
    return ranked[0]?.missing ?? []
  }
  return manifest.requires.filter((key) => !process.env[key])
}

/** How to turn an inactive integration on, for the prompt and setup errors. */
function requirementSummary(manifest: IntegrationManifest): string {
  if (manifest.anyOf?.length) {
    return `any one of: ${manifest.anyOf.map((group) => group.join(" + ")).join(" | ")}`
  }
  return manifest.requires.join(", ")
}

export function activeIntegrations(): IntegrationManifest[] {
  return INTEGRATIONS.filter((entry) => isConfigured(entry.id))
}

export function inactiveIntegrations(): IntegrationManifest[] {
  return INTEGRATIONS.filter((entry) => !isConfigured(entry.id))
}

/**
 * Render the active integration set for the system prompt. Inactive
 * integrations are listed by name only, with the env vars they need, so the
 * agent can tell a user exactly what to set instead of guessing.
 */
export function renderCapabilities(): string {
  const active = activeIntegrations()
  const inactive = inactiveIntegrations()
  const lines: string[] = []

  if (active.length === 0) {
    lines.push(
      "No integrations are configured yet. You have the sandbox, web search, and",
      "web fetch, but no connection to a CRM or ad platform. If someone asks you",
      "to do marketing ops work, tell them which environment variables to set:",
      ""
    )
    for (const entry of INTEGRATIONS) {
      lines.push(`- ${entry.name}: ${requirementSummary(entry)}`)
    }
    return lines.join("\n")
  }

  lines.push("## Connected systems", "")
  for (const entry of active) {
    lines.push(`### ${entry.name} — ${entry.description}`)
    if (entry.id === "tracker") {
      const summary = trackerSummary()
      if (summary) lines.push(summary, "")
    }
    if (entry.id === "salesforce") {
      lines.push(
        `This org imports people from a list as **${config.salesforce.importObject}s**` +
          (config.salesforce.importObject === "Contact"
            ? " — it does not use Leads, so a Contact needs an Account resolved before import."
            : ".") +
          "",
        ""
      )
    }
    for (const capability of entry.capabilities) lines.push(`- ${capability}`)
    lines.push("", "Things people ask for:")
    for (const example of entry.examples) lines.push(`- "${example}"`)
    lines.push("")
  }

  if (inactive.length > 0) {
    lines.push(
      "## Not connected",
      "",
      "These are available but not configured on this install. If someone asks",
      "for one, say it is not connected and name the environment variables:",
      ""
    )
    for (const entry of inactive) {
      lines.push(`- ${entry.name} — needs ${requirementSummary(entry)}`)
    }
  }

  return lines.join("\n")
}
