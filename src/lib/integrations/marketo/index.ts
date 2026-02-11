/**
 * Marketo Integration Module
 */

import type { Integration } from "../types"
import { marketoTools } from "./tools"

export const marketoIntegration: Integration = {
  name: "Marketo",
  description: "Marketing automation platform",
  capabilities: [
    "Search and manage leads by any field",
    "Create, update, and delete lead records",
    "Describe lead fields and schema",
    "Manage static lists (view, add, remove leads)",
    "List and trigger smart campaigns",
    "View programs and email assets",
  ],
  examples: [
    "Search Marketo for leads at Acme Corp",
    "What fields are available on the Marketo lead object?",
    "Show me all Marketo static lists",
    "Add these leads to the webinar list",
    "Trigger the welcome email campaign for lead 12345",
  ],
  isConfigured: () => {
    return !!(
      process.env.MARKETO_CLIENT_ID &&
      process.env.MARKETO_CLIENT_SECRET &&
      process.env.MARKETO_REST_ENDPOINT
    )
  },
  getTools: () => marketoTools,
}
