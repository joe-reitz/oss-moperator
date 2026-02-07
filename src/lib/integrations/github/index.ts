/**
 * GitHub Integration Module
 */

import type { Integration } from "../types"
import { githubTools } from "./tools"

export const githubIntegration: Integration = {
  name: "GitHub",
  description: "Repository activity",
  capabilities: [
    "View recent commits and release notes",
    "Summarize what shipped in a given time period",
    "Generate changelogs from commit history",
  ],
  examples: [
    "What shipped this week?",
    "Show me recent changes",
    "Generate release notes for the last 2 weeks",
  ],
  isConfigured: () => {
    return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO)
  },
  getTools: () => githubTools,
}
