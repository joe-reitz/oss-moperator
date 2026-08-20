/**
 * GitHub tools.
 *
 * Narrow on purpose: reading what shipped, so the agent can answer "what went
 * out on the marketing site this week?" and draft release notes or a newsletter
 * section from real commits.
 *
 * For a fuller GitHub surface — issues, PRs, reviews, with per-user OAuth and
 * approval rules — run `eve add extension/github-tools`. See docs/connections.md.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import * as client from "../lib/github/client"
import { isConfigured } from "../lib/integrations"

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("github")) return null

      return {
        get_repo_commits: defineTool({
          description: `List commits on the configured repository, newest first, with author, date, message, and URL.

Use it for "what shipped this week", release notes, and newsletter copy. Dates are ISO 8601; omit both to get the most recent commits.`,
          inputSchema: z.object({
            since: z
              .string()
              .optional()
              .describe("ISO 8601 date — only commits after this"),
            until: z
              .string()
              .optional()
              .describe("ISO 8601 date — only commits before this"),
          }),
          async execute({ since, until }) {
            try {
              const commits = await client.getCommits(since, until)
              return {
                success: true as const,
                repo: process.env.GITHUB_REPO,
                count: commits.length,
                commits,
              }
            } catch (error) {
              return {
                success: false as const,
                error:
                  error instanceof Error ? error.message : "Failed to fetch commits",
              }
            }
          },
        }),
      }
    },
  },
})
