/**
 * Integration Loader
 *
 * Auto-discovers and loads integrations based on env var configuration.
 * Only integrations with all required env vars will be activated.
 */

import type { Integration } from "./types"
import type { Tool } from "ai"

// Import all integrations
import { salesforceIntegration } from "./salesforce"
import { linearIntegration } from "./linear"
import { githubIntegration } from "./github"

/** All available integrations — add new ones here */
const ALL_INTEGRATIONS: Integration[] = [
  salesforceIntegration,
  linearIntegration,
  githubIntegration,
]

/** Get only the integrations that are configured */
export function getActiveIntegrations(): Integration[] {
  return ALL_INTEGRATIONS.filter((i) => i.isConfigured())
}

/** Get all integrations (including unconfigured) */
export function getAllIntegrations(): Integration[] {
  return ALL_INTEGRATIONS
}

/** Assemble tools from all active integrations */
export function getIntegrationTools(): Record<string, Tool> {
  const tools: Record<string, Tool> = {}
  for (const integration of getActiveIntegrations()) {
    Object.assign(tools, integration.getTools())
  }
  return tools
}

/** Generate capabilities text for the system prompt */
export function generateCapabilitiesText(): string {
  const active = getActiveIntegrations()
  const inactive = ALL_INTEGRATIONS.filter((i) => !i.isConfigured())

  if (active.length === 0) {
    return "No integrations are currently configured. Check your environment variables and see the setup guides."
  }

  const activeText = active
    .map((i) => {
      const caps = i.capabilities.map((c) => `- ${c}`).join("\n")
      const examples = i.examples.map((e) => `  - "${e}"`).join("\n")
      return `${i.name} (${i.description})\n${caps}\n  Example prompts:\n${examples}`
    })
    .join("\n\n")

  let text = `*Active Integrations:*\n\n${activeText}`

  if (inactive.length > 0) {
    const inactiveList = inactive.map((i) => `- ${i.name}: Not configured`).join("\n")
    text += `\n\n*Available but not configured:*\n${inactiveList}`
  }

  return text
}

/** Get names of active integrations */
export function getActiveIntegrationNames(): string[] {
  return getActiveIntegrations().map((i) => i.name)
}
