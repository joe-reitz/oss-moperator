/**
 * Salesforce Integration Module
 */

import type { Integration } from "../types"
import { salesforceTools } from "./tools"

export const salesforceIntegration: Integration = {
  name: "Salesforce",
  description: "CRM data management",
  capabilities: [
    "Query data (Contacts, Leads, Accounts, Campaigns, CampaignMembers)",
    "Add contacts to campaigns",
    "Update records (including bulk updates)",
    "Create new records",
    "Delete records (admin only)",
    "Export query results as CSV",
  ],
  examples: [
    "Show me active campaigns",
    "How many contacts are in campaign X?",
    "Add these contacts to campaign Y",
    "Export contacts from company ABC as CSV",
  ],
  isConfigured: () => {
    return !!(
      process.env.SALESFORCE_ACCESS_TOKEN &&
      process.env.SALESFORCE_INSTANCE_URL
    )
  },
  getTools: () => salesforceTools,
}

// Re-export client for OAuth routes
export { getAuthorizationUrl, exchangeCodeForTokens } from "./client"
