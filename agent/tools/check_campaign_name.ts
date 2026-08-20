/**
 * Check campaign names against the org's naming convention.
 *
 * Consistent names are what make quarter-over-quarter reporting possible, so
 * this runs before creating a Salesforce campaign, a Marketo program, or a
 * Google Ads campaign.
 */
import { defineTool } from "eve/tools"
import { z } from "zod"

import { config } from "../lib/config"
import { normalizeToken } from "../lib/tracking"

export default defineTool({
  description: `Check a campaign name against the org's naming convention, and propose a compliant name when it does not match.

Call this before creating a Salesforce campaign, a Marketo program, or a Google Ads campaign. Consistent names are what make quarter-over-quarter reporting possible at all.

Convention: ${config.conventions.campaignNamePattern}
Example: ${config.conventions.campaignNameExample}`,
  inputSchema: z.object({
    names: z.array(z.string()).min(1).describe("Campaign names to check"),
  }),
  execute({ names }) {
    let pattern: RegExp
    try {
      pattern = new RegExp(config.conventions.campaignNamePattern)
    } catch {
      return {
        success: false as const,
        error:
          "MOPERATOR_CAMPAIGN_NAME_PATTERN is not a valid regular expression. Fix it in the environment, then retry.",
      }
    }

    return {
      success: true as const,
      convention: config.conventions.campaignNamePattern,
      example: config.conventions.campaignNameExample,
      results: names.map((name) => ({
        name,
        compliant: pattern.test(name),
        normalized_slug: normalizeToken(name),
      })),
    }
  },
})
