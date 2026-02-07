/**
 * Dynamic Tool Assembly
 *
 * Collects tools from all active integrations.
 * This is the single source of truth for what tools the agent has access to.
 */

import { getIntegrationTools } from "./integrations"

export function getAllTools() {
  return getIntegrationTools()
}
