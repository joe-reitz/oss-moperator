/**
 * GitHub AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as github from "./client"

export const githubTools = {
  getRepoCommits: tool({
    description: `Fetch recent commits from the GitHub repository. Use for release notes, changelogs, or "what shipped" queries.`,
    inputSchema: z.object({
      since: z.string().optional().describe("ISO 8601 date — only commits after this date"),
      until: z.string().optional().describe("ISO 8601 date — only commits before this date"),
    }),
    execute: async ({ since, until }) => {
      try {
        const commits = await github.getCommits(since, until)
        return { success: true as const, count: commits.length, commits }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed" }
      }
    },
  }),
}
