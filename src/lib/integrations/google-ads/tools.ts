/**
 * Google Ads AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as client from "./client"

// Max lengths enforced by Google Ads
const MAX_HEADLINE_LENGTH = 30
const MAX_DESCRIPTION_LENGTH = 90

function microsToUsd(micros: string | number): string {
  const val = Number(micros) / 1_000_000
  return `$${val.toFixed(2)}`
}

function formatCampaign(row: Record<string, unknown>): Record<string, unknown> {
  const campaign = row.campaign as Record<string, unknown> | undefined
  const budget = row.campaignBudget as Record<string, unknown> | undefined
  const metrics = row.metrics as Record<string, unknown> | undefined

  return {
    id: campaign?.id,
    name: campaign?.name,
    status: campaign?.status,
    channelType: campaign?.advertisingChannelType,
    dailyBudget: budget?.amountMicros ? microsToUsd(budget.amountMicros as string) : null,
    impressions: metrics?.impressions ? Number(metrics.impressions) : null,
    clicks: metrics?.clicks ? Number(metrics.clicks) : null,
    cost: metrics?.costMicros ? microsToUsd(metrics.costMicros as string) : null,
    conversions: metrics?.conversions ? Number(metrics.conversions) : null,
    ctr: metrics?.ctr,
    avgCpc: metrics?.averageCpc ? microsToUsd(metrics.averageCpc as string) : null,
  }
}

// =============================================================================
// Schemas (exported for approval wrapper)
// =============================================================================

export const googleAdsCreateCampaignSchema = z.object({
  name: z.string().describe("Campaign name"),
  dailyBudgetUsd: z.number().describe("Daily budget in USD (e.g., 100 for $100/day)"),
  channelType: z.enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"])
    .describe("Advertising channel type"),
})

export const googleAdsUpdateCampaignBudgetSchema = z.object({
  campaignId: z.string().describe("The Google Ads campaign ID"),
  dailyBudgetUsd: z.number().describe("New daily budget in USD"),
})

export const googleAdsUpdateCampaignStatusSchema = z.object({
  campaignId: z.string().describe("The Google Ads campaign ID"),
  status: z.enum(["ENABLED", "PAUSED"]).describe("New campaign status — ENABLED starts serving ads, PAUSED stops"),
})

export const googleAdsCreateAdGroupSchema = z.object({
  campaignId: z.string().describe("The campaign ID to create the ad group under"),
  name: z.string().describe("Ad group name (e.g., 'Brand Keywords', 'Competitor Terms')"),
  cpcBidUsd: z.number().optional().describe("Max CPC bid in USD (e.g., 2.50 for $2.50). Optional — uses campaign default if omitted."),
})

export const googleAdsCreateAdSchema = z.object({
  campaignId: z.string().describe("The campaign ID (used to look up the ad group)"),
  adGroupName: z.string().optional().describe("Ad group name — if omitted, uses the first ad group in the campaign"),
  headlines: z.array(z.string().max(MAX_HEADLINE_LENGTH)).min(3).max(15)
    .describe(`3-15 headlines, max ${MAX_HEADLINE_LENGTH} chars each. Google rotates these automatically. First 3 can show together.`),
  descriptions: z.array(z.string().max(MAX_DESCRIPTION_LENGTH)).min(2).max(4)
    .describe(`2-4 descriptions, max ${MAX_DESCRIPTION_LENGTH} chars each.`),
  finalUrl: z.string().describe("Landing page URL (e.g., 'https://example.com/landing')"),
  path1: z.string().max(15).optional().describe("Display URL path 1, max 15 chars (e.g., 'products')"),
  path2: z.string().max(15).optional().describe("Display URL path 2, max 15 chars (e.g., 'sale')"),
})

// =============================================================================
// Tools
// =============================================================================

export const googleAdsTools = {
  googleAdsListCampaigns: tool({
    description: `List all Google Ads campaigns with their status, daily budget, and performance metrics (impressions, clicks, cost, conversions). Returns up to 50 campaigns sorted by spend.`,
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const results = await client.listCampaigns()
        const campaigns = results.map(formatCampaign)
        return { success: true as const, campaigns, count: campaigns.length }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to list campaigns" }
      }
    },
  }),

  googleAdsGetCampaign: tool({
    description: `Get detailed information about a specific Google Ads campaign by ID, including budget and performance metrics.`,
    inputSchema: z.object({
      campaignId: z.string().describe("The Google Ads campaign ID"),
    }),
    execute: async ({ campaignId }) => {
      try {
        const result = await client.getCampaign(campaignId)
        if (!result) return { success: false as const, error: `Campaign ${campaignId} not found` }
        return { success: true as const, campaign: formatCampaign(result) }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to get campaign" }
      }
    },
  }),

  googleAdsCreateCampaign: tool({
    description: `Create a new Google Ads campaign with a daily budget. The campaign is created in PAUSED status — it must be explicitly enabled after review. CRITICAL: This involves ad spend and requires growth team approval.`,
    inputSchema: googleAdsCreateCampaignSchema,
    execute: async ({ name, dailyBudgetUsd, channelType }) => {
      try {
        const budgetMicros = Math.round(dailyBudgetUsd * 1_000_000)
        const budgetResource = await client.createCampaignBudget(budgetMicros)
        const campaignResource = await client.createCampaign({
          name,
          budgetResourceName: budgetResource,
          channelType,
          status: "PAUSED",
        })
        return {
          success: true as const,
          campaignResource,
          budgetResource,
          name,
          dailyBudget: `$${dailyBudgetUsd}`,
          status: "PAUSED",
          note: "Campaign created in PAUSED status. Enable it when ready to serve ads.",
        }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create campaign" }
      }
    },
  }),

  googleAdsUpdateCampaignBudget: tool({
    description: `Update the daily budget for a Google Ads campaign. CRITICAL: This changes ad spend and requires growth team approval.`,
    inputSchema: googleAdsUpdateCampaignBudgetSchema,
    execute: async ({ campaignId, dailyBudgetUsd }) => {
      try {
        // First get the campaign to find its budget resource name
        const campaign = await client.getCampaign(campaignId)
        if (!campaign) return { success: false as const, error: `Campaign ${campaignId} not found` }

        const budget = campaign.campaignBudget as Record<string, unknown> | undefined
        if (!budget?.resourceName) {
          return { success: false as const, error: "Campaign has no associated budget" }
        }

        const budgetMicros = Math.round(dailyBudgetUsd * 1_000_000)
        await client.updateCampaignBudget(budget.resourceName as string, budgetMicros)

        return {
          success: true as const,
          campaignId,
          newDailyBudget: `$${dailyBudgetUsd}`,
        }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update budget" }
      }
    },
  }),

  googleAdsUpdateCampaignStatus: tool({
    description: `Enable or pause a Google Ads campaign. Enabling a campaign starts serving ads and spending budget. CRITICAL: This affects ad spend and requires growth team approval.`,
    inputSchema: googleAdsUpdateCampaignStatusSchema,
    execute: async ({ campaignId, status }) => {
      try {
        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
        const resourceName = `customers/${customerId}/campaigns/${campaignId}`
        await client.updateCampaignStatus(resourceName, status)
        return { success: true as const, campaignId, status }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update status" }
      }
    },
  }),

  googleAdsGetPerformance: tool({
    description: `Get performance metrics for Google Ads campaigns over a date range. Returns daily breakdown of impressions, clicks, cost, conversions, CTR, and CPC. Use GAQL date ranges like LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, or LAST_MONTH.`,
    inputSchema: z.object({
      campaignId: z.string().optional().describe("Campaign ID to filter by (omit for all campaigns)"),
      dateRange: z.string().describe("GAQL date range: LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH, etc."),
    }),
    execute: async ({ campaignId, dateRange }) => {
      try {
        const results = await client.getCampaignPerformance(campaignId, dateRange)
        const rows = results.map(row => {
          const campaign = row.campaign as Record<string, unknown>
          const segments = row.segments as Record<string, unknown> | undefined
          const metrics = row.metrics as Record<string, unknown>
          return {
            campaignId: campaign?.id,
            campaignName: campaign?.name,
            date: segments?.date,
            impressions: Number(metrics?.impressions || 0),
            clicks: Number(metrics?.clicks || 0),
            cost: microsToUsd(metrics?.costMicros as string || "0"),
            conversions: Number(metrics?.conversions || 0),
            ctr: metrics?.ctr,
            avgCpc: metrics?.averageCpc ? microsToUsd(metrics.averageCpc as string) : null,
          }
        })
        return { success: true as const, rows, count: rows.length }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to get performance" }
      }
    },
  }),

  googleAdsGetDashboardLink: tool({
    description: `Get a direct link to the Google Ads dashboard for a campaign or the account overview. Use this when the user wants to see more details in the native Google Ads UI.`,
    inputSchema: z.object({
      campaignId: z.string().optional().describe("Campaign ID (omit for account overview)"),
    }),
    execute: async ({ campaignId }) => {
      const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ""
      if (campaignId) {
        return {
          success: true as const,
          url: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&ocid=${customerId}`,
        }
      }
      return {
        success: true as const,
        url: `https://ads.google.com/aw/overview?ocid=${customerId}`,
      }
    },
  }),

  // =============================================================================
  // Ad Group & Ad Creative Tools
  // =============================================================================

  googleAdsCreateAdGroup: tool({
    description: `Create an ad group within a Google Ads campaign. Ad groups contain your ads and keywords. CRITICAL: This is part of ad setup and requires growth team approval.`,
    inputSchema: googleAdsCreateAdGroupSchema,
    execute: async ({ campaignId, name, cpcBidUsd }) => {
      try {
        const cpcBidMicros = cpcBidUsd ? Math.round(cpcBidUsd * 1_000_000) : undefined
        const resourceName = await client.createAdGroup({ campaignId, name, cpcBidMicros })
        return {
          success: true as const,
          adGroupResource: resourceName,
          campaignId,
          name,
          ...(cpcBidUsd ? { maxCpcBid: `$${cpcBidUsd}` } : {}),
        }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create ad group" }
      }
    },
  }),

  googleAdsCreateAd: tool({
    description: `Create a responsive search ad in a Google Ads campaign. Provide headlines (3-15, max 30 chars each) and descriptions (2-4, max 90 chars each). Google automatically tests combinations to find the best performers. CRITICAL: This is part of ad setup and requires growth team approval.

Example headlines: "Deploy to Vercel", "Next.js Framework", "Ship Faster Today"
Example descriptions: "Build and deploy web applications with zero configuration. Start free.", "The platform for frontend developers. Ship with confidence."`,
    inputSchema: googleAdsCreateAdSchema,
    execute: async ({ campaignId, adGroupName, headlines, descriptions, finalUrl, path1, path2 }) => {
      try {
        // Find or create ad group
        let adGroupResourceName: string

        const existingGroups = await client.listAdGroups(campaignId)
        if (adGroupName) {
          const match = existingGroups.find(g => {
            const ag = g.adGroup as Record<string, unknown> | undefined
            return ag?.name === adGroupName
          })
          if (match) {
            adGroupResourceName = (match.adGroup as Record<string, unknown>).resourceName as string
          } else {
            adGroupResourceName = await client.createAdGroup({ campaignId, name: adGroupName })
          }
        } else if (existingGroups.length > 0) {
          adGroupResourceName = (existingGroups[0].adGroup as Record<string, unknown>).resourceName as string
        } else {
          adGroupResourceName = await client.createAdGroup({ campaignId, name: "Default Ad Group" })
        }

        const adResource = await client.createResponsiveSearchAd({
          adGroupResourceName,
          headlines,
          descriptions,
          finalUrl,
          path1,
          path2,
        })

        return {
          success: true as const,
          adResource,
          adGroupResource: adGroupResourceName,
          headlineCount: headlines.length,
          descriptionCount: descriptions.length,
          finalUrl,
          note: "Responsive search ad created. Google will automatically test headline/description combinations.",
        }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create ad" }
      }
    },
  }),

  googleAdsListAdGroups: tool({
    description: `List ad groups within a Google Ads campaign, including their status, bid, and performance metrics.`,
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
    }),
    execute: async ({ campaignId }) => {
      try {
        const results = await client.listAdGroups(campaignId)
        const groups = results.map(row => {
          const ag = row.adGroup as Record<string, unknown>
          const metrics = row.metrics as Record<string, unknown> | undefined
          return {
            id: ag?.id,
            name: ag?.name,
            status: ag?.status,
            type: ag?.type,
            maxCpcBid: ag?.cpcBidMicros ? microsToUsd(ag.cpcBidMicros as string) : null,
            impressions: metrics?.impressions ? Number(metrics.impressions) : null,
            clicks: metrics?.clicks ? Number(metrics.clicks) : null,
            cost: metrics?.costMicros ? microsToUsd(metrics.costMicros as string) : null,
          }
        })
        return { success: true as const, adGroups: groups, count: groups.length }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to list ad groups" }
      }
    },
  }),

  googleAdsListAds: tool({
    description: `List ads within a Google Ads ad group, including their headlines, descriptions, and performance metrics.`,
    inputSchema: z.object({
      adGroupId: z.string().describe("The ad group ID"),
    }),
    execute: async ({ adGroupId }) => {
      try {
        const results = await client.listAds(adGroupId)
        const ads = results.map(row => {
          const adGroupAd = row.adGroupAd as Record<string, unknown>
          const ad = adGroupAd?.ad as Record<string, unknown> | undefined
          const rsa = ad?.responsiveSearchAd as Record<string, unknown> | undefined
          const metrics = row.metrics as Record<string, unknown> | undefined
          return {
            id: ad?.id,
            status: adGroupAd?.status,
            headlines: (rsa?.headlines as Array<Record<string, unknown>>)?.map(h => h.text) || [],
            descriptions: (rsa?.descriptions as Array<Record<string, unknown>>)?.map(d => d.text) || [],
            finalUrls: ad?.finalUrls,
            impressions: metrics?.impressions ? Number(metrics.impressions) : null,
            clicks: metrics?.clicks ? Number(metrics.clicks) : null,
            cost: metrics?.costMicros ? microsToUsd(metrics.costMicros as string) : null,
          }
        })
        return { success: true as const, ads, count: ads.length }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to list ads" }
      }
    },
  }),
}
