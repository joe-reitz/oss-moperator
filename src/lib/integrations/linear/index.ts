/**
 * Linear Integration Module
 */

import type { Integration } from "../types"
import { linearTools } from "./tools"

export const linearIntegration: Integration = {
  name: "Linear",
  description: "Issue tracking",
  capabilities: [
    "File bug reports directly from Slack",
    "Submit feature requests",
    "Create issues with auto-enriched titles, descriptions, and priority",
    "Auto-label issues based on context",
    "Query open issues by status, assignee, label, or date",
  ],
  examples: [
    "File a bug: dashboard spinner never stops",
    "Feature request: add date filtering to reports",
    "What's in triage right now?",
    "Show me issues assigned to Joe",
  ],
  isConfigured: () => {
    return !!process.env.LINEAR_API_KEY
  },
  getTools: () => linearTools,
}

export { fileIssueFromMessage } from "./tools"
