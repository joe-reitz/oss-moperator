/**
 * HubSpot Integration Module
 */

import type { Integration } from "../types"
import { hubspotTools } from "./tools"

export const hubspotIntegration: Integration = {
  name: "HubSpot",
  description: "CRM and marketing automation",
  capabilities: [
    "Search and manage contacts, companies, and deals",
    "Create, update, and delete CRM records",
    "Manage contact lists (add/remove members)",
    "View deal pipelines and stages",
    "List HubSpot owners for record assignment",
  ],
  examples: [
    "Search HubSpot for contacts at Acme Corp",
    "Create a new contact in HubSpot",
    "Show me all deals closing this month",
    "Add these contacts to the newsletter list",
    "Who are the HubSpot owners?",
  ],
  isConfigured: () => {
    return !!process.env.HUBSPOT_API_TOKEN
  },
  getTools: () => hubspotTools,
}
