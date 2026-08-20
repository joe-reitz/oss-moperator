/**
 * Build tracked campaign URLs with consistent UTM parameters.
 *
 * Always available: no external service, no credentials — just the org's
 * conventions from `agent/lib/config.ts`, applied the same way every time.
 */
import { defineTool } from "eve/tools"
import { z } from "zod"

import { config } from "../lib/config"
import { normalizeToken, UTM_KEYS } from "../lib/tracking"

export default defineTool({
  description: `Build tracked campaign URLs with consistent UTM parameters.

Use this any time someone asks for a link to put in an email, an ad, a social post, or an event page — do not hand-assemble UTMs, because casing and separator drift is what breaks channel reporting.

Pass several channels at once to get one link per channel with a shared campaign name. Values are normalized to lowercase-hyphenated form, and any value outside the org's allowed list comes back as a warning rather than a silent rename, so you can check with the user.

Allowed mediums: ${config.conventions.mediums.join(", ") || "any"}.
Allowed sources: ${config.conventions.sources.join(", ") || "any"}.`,
  inputSchema: z.object({
    destination_url: z
      .string()
      .url()
      .describe("The landing page URL, without UTM parameters"),
    campaign: z
      .string()
      .describe(
        `The campaign name, shared across every channel. Should follow the org convention, e.g. ${config.conventions.campaignNameExample}`
      ),
    channels: z
      .array(
        z.object({
          source: z.string().describe("utm_source, e.g. linkedin, google, newsletter"),
          medium: z.string().describe("utm_medium, e.g. paid-social, email, event"),
          content: z
            .string()
            .optional()
            .describe("utm_content — distinguishes variants, e.g. hero-cta vs footer-cta"),
          term: z.string().optional().describe("utm_term — paid search keyword"),
        })
      )
      .min(1)
      .describe("One entry per place the link will appear"),
    campaign_id: z
      .string()
      .optional()
      .describe("utm_id, e.g. the Salesforce Campaign ID, for exact attribution"),
  }),
  execute({ destination_url, campaign, channels, campaign_id }) {
    const warnings: string[] = []
    const normalizedCampaign = normalizeToken(campaign)

    if (normalizedCampaign !== campaign.toLowerCase()) {
      warnings.push(
        `Campaign name normalized to "${normalizedCampaign}" for the URL. The Salesforce campaign itself can keep its original name.`
      )
    }

    const links = channels.map((channel) => {
      const source = normalizeToken(channel.source)
      const medium = normalizeToken(channel.medium)

      if (
        config.conventions.mediums.length > 0 &&
        !config.conventions.mediums.includes(medium)
      ) {
        warnings.push(
          `"${medium}" is not one of the approved mediums (${config.conventions.mediums.join(", ")}). Confirm before using it — an off-list medium fragments channel reporting.`
        )
      }
      if (
        config.conventions.sources.length > 0 &&
        !config.conventions.sources.includes(source)
      ) {
        warnings.push(
          `"${source}" is not one of the approved sources (${config.conventions.sources.join(", ")}). Confirm before using it.`
        )
      }

      let url: URL
      try {
        url = new URL(destination_url)
      } catch {
        // Schema validation should have caught this; be explicit anyway.
        throw new Error(`"${destination_url}" is not a valid URL.`)
      }

      // Drop any UTMs already on the destination so we never emit duplicates.
      for (const key of UTM_KEYS) url.searchParams.delete(key)

      url.searchParams.set("utm_source", source)
      url.searchParams.set("utm_medium", medium)
      url.searchParams.set("utm_campaign", normalizedCampaign)
      if (channel.content) url.searchParams.set("utm_content", normalizeToken(channel.content))
      if (channel.term) url.searchParams.set("utm_term", normalizeToken(channel.term))
      if (campaign_id) url.searchParams.set("utm_id", campaign_id)

      return {
        placement: `${source} / ${medium}${channel.content ? ` / ${channel.content}` : ""}`,
        url: url.toString(),
      }
    })

    return {
      success: true as const,
      campaign: normalizedCampaign,
      links,
      warnings: Array.from(new Set(warnings)),
    }
  },
})
