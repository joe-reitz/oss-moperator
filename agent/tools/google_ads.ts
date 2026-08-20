/**
 * Google Ads tools.
 *
 * Everything that can move money carries `spendApproval()` — always a human,
 * every time, with no approver bypass. Who is allowed to *answer* that prompt
 * is narrowed to `GROWTH_MARKETING_APPROVERS` in the Slack channel's
 * `onInputResponse`, so the person requesting a budget increase cannot approve
 * their own request unless they are also on the spend list.
 *
 * New campaigns are always created PAUSED. Serving is a separate, separately
 * approved decision.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { requireSpendApprover, spendApproval } from "../lib/approval"
import * as client from "../lib/google-ads/client"
import { config } from "../lib/config"
import { isConfigured } from "../lib/integrations"

/** Google Ads speaks micros; humans speak dollars. */
const MICROS = 1_000_000

function usd(micros: string | number | undefined): string | null {
  if (micros === undefined || micros === null) return null
  return `$${(Number(micros) / MICROS).toFixed(2)}`
}

function toMicros(dollars: number): number {
  return Math.round(dollars * MICROS)
}

function formatCampaign(row: Record<string, unknown>): Record<string, unknown> {
  const campaign = row.campaign as Record<string, unknown> | undefined
  const budget = row.campaignBudget as Record<string, unknown> | undefined
  const metrics = row.metrics as Record<string, unknown> | undefined

  return {
    id: campaign?.id,
    name: campaign?.name,
    status: campaign?.status,
    channel_type: campaign?.advertisingChannelType,
    start_date: campaign?.startDate,
    end_date: campaign?.endDate,
    daily_budget: usd(budget?.amountMicros as string | undefined),
    impressions: metrics?.impressions ? Number(metrics.impressions) : null,
    clicks: metrics?.clicks ? Number(metrics.clicks) : null,
    cost: usd(metrics?.costMicros as string | undefined),
    conversions: metrics?.conversions ? Number(metrics.conversions) : null,
    ctr: metrics?.ctr,
    avg_cpc: usd(metrics?.averageCpc as string | undefined),
    cost_per_conversion:
      metrics?.costMicros && Number(metrics?.conversions) > 0
        ? usd(Number(metrics.costMicros) / Number(metrics.conversions))
        : null,
  }
}

const MAX_HEADLINE = 30
const MAX_DESCRIPTION = 90

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("google_ads")) return null

      return {
        // ── Read ────────────────────────────────────────────────────────────

        list_google_ads_campaigns: defineTool({
          description:
            "List Google Ads campaigns with status, daily budget, and lifetime performance — impressions, clicks, cost, conversions, CTR, average CPC, and cost per conversion. Up to 50 campaigns, highest spend first.",
          inputSchema: z.object({}),
          async execute() {
            try {
              const rows = await client.listCampaigns()
              const campaigns = rows.map(formatCampaign)
              return { success: true as const, count: campaigns.length, campaigns }
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        get_google_ads_campaign: defineTool({
          description:
            "Get one Google Ads campaign by ID, with its budget and performance.",
          inputSchema: z.object({
            campaign_id: z.string().describe("The Google Ads campaign ID"),
          }),
          async execute({ campaign_id }) {
            try {
              const row = await client.getCampaign(campaign_id)
              if (!row) {
                return {
                  success: false as const,
                  error: `Campaign ${campaign_id} not found`,
                }
              }
              return { success: true as const, campaign: formatCampaign(row) }
            } catch (error) {
              return fail(error, "Failed to get campaign")
            }
          },
        }),

        get_google_ads_performance: defineTool({
          description: `Get a daily performance breakdown for Google Ads campaigns over a date range.

Use GAQL date ranges: TODAY, YESTERDAY, LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH, THIS_WEEK_MON_TODAY, LAST_BUSINESS_WEEK.

Omit campaign_id for every campaign. For a big range across many campaigns, expect a lot of rows — consider summarizing in the sandbox rather than reading every row.`,
          inputSchema: z.object({
            campaign_id: z
              .string()
              .optional()
              .describe("Campaign ID to filter to. Omit for all campaigns."),
            date_range: z
              .string()
              .describe("GAQL date range, e.g. LAST_30_DAYS or THIS_MONTH"),
          }),
          async execute({ campaign_id, date_range }) {
            try {
              const results = await client.getCampaignPerformance(
                campaign_id,
                date_range
              )
              const rows = results.map((row) => {
                const campaign = row.campaign as Record<string, unknown> | undefined
                const segments = row.segments as Record<string, unknown> | undefined
                const metrics = row.metrics as Record<string, unknown> | undefined
                return {
                  campaign_id: campaign?.id,
                  campaign_name: campaign?.name,
                  date: segments?.date,
                  impressions: Number(metrics?.impressions || 0),
                  clicks: Number(metrics?.clicks || 0),
                  cost: usd(metrics?.costMicros as string | undefined),
                  conversions: Number(metrics?.conversions || 0),
                  ctr: metrics?.ctr,
                  avg_cpc: usd(metrics?.averageCpc as string | undefined),
                }
              })
              return { success: true as const, count: rows.length, rows }
            } catch (error) {
              return fail(error, "Failed to get performance")
            }
          },
        }),

        list_google_ads_ad_groups: defineTool({
          description:
            "List the ad groups in a Google Ads campaign, with bids and performance.",
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign ID"),
          }),
          async execute({ campaign_id }) {
            try {
              const rows = await client.listAdGroups(campaign_id)
              return {
                success: true as const,
                count: rows.length,
                ad_groups: rows.map((row) => {
                  const group = row.adGroup as Record<string, unknown> | undefined
                  const metrics = row.metrics as Record<string, unknown> | undefined
                  return {
                    id: group?.id,
                    name: group?.name,
                    status: group?.status,
                    type: group?.type,
                    cpc_bid: usd(group?.cpcBidMicros as string | undefined),
                    impressions: Number(metrics?.impressions || 0),
                    clicks: Number(metrics?.clicks || 0),
                    cost: usd(metrics?.costMicros as string | undefined),
                    conversions: Number(metrics?.conversions || 0),
                  }
                }),
              }
            } catch (error) {
              return fail(error, "Failed to list ad groups")
            }
          },
        }),

        list_google_ads_ads: defineTool({
          description:
            "List the ads in an ad group, with their headlines, descriptions, final URLs, and performance.",
          inputSchema: z.object({
            ad_group_id: z.string().describe("The ad group ID"),
          }),
          async execute({ ad_group_id }) {
            try {
              const rows = await client.listAds(ad_group_id)
              return { success: true as const, count: rows.length, ads: rows }
            } catch (error) {
              return fail(error, "Failed to list ads")
            }
          },
        }),

        get_google_ads_dashboard_link: defineTool({
          description:
            "Get a deep link into the Google Ads UI, for a campaign or the account overview. Use it when someone wants to go look at the real thing.",
          inputSchema: z.object({
            campaign_id: z
              .string()
              .optional()
              .describe("Campaign ID. Omit for the account overview."),
          }),
          execute({ campaign_id }) {
            const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ""
            const url = campaign_id
              ? `https://ads.google.com/aw/campaigns?campaignId=${campaign_id}&ocid=${customerId}`
              : `https://ads.google.com/aw/overview?ocid=${customerId}`
            return { success: true as const, url }
          },
        }),

        // ── Spend-affecting ─────────────────────────────────────────────────

        create_google_ads_campaign: defineTool({
          description: `Create a Google Ads campaign with a daily budget. Always created PAUSED — enabling it is a separate, separately approved step.

Before calling, state the campaign name, the daily budget, and the implied monthly spend (daily × 30.4) so the approver sees the real number. Always requires approval from a spend approver.`,
          inputSchema: z.object({
            name: z.string().describe("Campaign name"),
            daily_budget_usd: z
              .number()
              .positive()
              .describe("Daily budget in USD, e.g. 100 for $100/day"),
            channel_type: z
              .enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"])
              .describe("Advertising channel type"),
          }),
          approval: spendApproval(),
          async execute({ name, daily_budget_usd, channel_type }, ctx) {
            const denied = requireSpendApprover(ctx)
            if (denied) return denied

            try {
              const budgetResource = await client.createCampaignBudget(
                toMicros(daily_budget_usd)
              )
              const campaignResource = await client.createCampaign({
                name,
                budgetResourceName: budgetResource,
                channelType: channel_type,
                status: "PAUSED",
              })
              return {
                success: true as const,
                campaign_resource: campaignResource,
                budget_resource: budgetResource,
                name,
                daily_budget: `$${daily_budget_usd}`,
                monthly_estimate: `$${(daily_budget_usd * 30.4).toFixed(0)}`,
                status: "PAUSED",
                note: "Created PAUSED. It will not serve or spend until someone enables it.",
              }
            } catch (error) {
              return fail(error, "Failed to create campaign")
            }
          },
        }),

        update_google_ads_budget: defineTool({
          description: `Change a campaign's daily budget.

Before calling, state the current budget, the new budget, and the monthly delta. Always requires approval from a spend approver.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign ID"),
            daily_budget_usd: z
              .number()
              .positive()
              .describe("New daily budget in USD"),
          }),
          approval: spendApproval(),
          async execute({ campaign_id, daily_budget_usd }, ctx) {
            const denied = requireSpendApprover(ctx)
            if (denied) return denied

            try {
              const campaign = await client.getCampaign(campaign_id)
              if (!campaign) {
                return {
                  success: false as const,
                  error: `Campaign ${campaign_id} not found`,
                }
              }

              const budget = campaign.campaignBudget as
                | Record<string, unknown>
                | undefined
              if (!budget?.resourceName) {
                return {
                  success: false as const,
                  error:
                    "That campaign has no budget attached, so there is nothing to change.",
                }
              }

              const previous = usd(budget.amountMicros as string | undefined)
              await client.updateCampaignBudget(
                budget.resourceName as string,
                toMicros(daily_budget_usd)
              )

              return {
                success: true as const,
                campaign_id,
                previous_daily_budget: previous,
                new_daily_budget: `$${daily_budget_usd}`,
                monthly_estimate: `$${(daily_budget_usd * 30.4).toFixed(0)}`,
                above_warn_threshold:
                  daily_budget_usd > config.limits.adBudgetWarnUsd,
              }
            } catch (error) {
              return fail(error, "Failed to update budget")
            }
          },
        }),

        update_google_ads_campaign_status: defineTool({
          description: `Enable or pause a campaign. ENABLED starts serving ads and spending the daily budget immediately; PAUSED stops it.

Before enabling, state the daily budget that is about to start spending. Always requires approval from a spend approver.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign ID"),
            status: z
              .enum(["ENABLED", "PAUSED"])
              .describe("ENABLED starts serving; PAUSED stops it"),
          }),
          approval: spendApproval(),
          async execute({ campaign_id, status }, ctx) {
            const denied = requireSpendApprover(ctx)
            if (denied) return denied

            try {
              const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
              await client.updateCampaignStatus(
                `customers/${customerId}/campaigns/${campaign_id}`,
                status
              )
              return { success: true as const, campaign_id, status }
            } catch (error) {
              return fail(error, "Failed to update campaign status")
            }
          },
        }),

        create_google_ads_ad_group: defineTool({
          description:
            "Create an ad group inside a campaign. Ad groups hold the ads and keywords. Requires approval from a spend approver, since the CPC bid affects spend.",
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign to create it under"),
            name: z
              .string()
              .describe("Ad group name, e.g. 'Brand Keywords' or 'Competitor Terms'"),
            cpc_bid_usd: z
              .number()
              .positive()
              .optional()
              .describe("Max CPC bid in USD. Omit to use the campaign default."),
          }),
          approval: spendApproval(),
          async execute({ campaign_id, name, cpc_bid_usd }, ctx) {
            const denied = requireSpendApprover(ctx)
            if (denied) return denied

            try {
              const resourceName = await client.createAdGroup({
                campaignId: campaign_id,
                name,
                cpcBidMicros: cpc_bid_usd ? toMicros(cpc_bid_usd) : undefined,
              })
              return {
                success: true as const,
                ad_group_resource: resourceName,
                campaign_id,
                name,
                cpc_bid: cpc_bid_usd ? `$${cpc_bid_usd}` : "campaign default",
              }
            } catch (error) {
              return fail(error, "Failed to create ad group")
            }
          },
        }),

        create_google_ads_ad: defineTool({
          description: `Create a responsive search ad in an ad group.

Google rotates and combines the assets you give it, so write ${MAX_HEADLINE}-char headlines and ${MAX_DESCRIPTION}-char descriptions that read correctly in any order. Show the user the full creative before calling. Requires approval from a spend approver.`,
          inputSchema: z.object({
            campaign_id: z.string().describe("The campaign ID, used to find the ad group"),
            ad_group_name: z
              .string()
              .optional()
              .describe("Ad group name. Omit to use the campaign's first ad group."),
            headlines: z
              .array(z.string().max(MAX_HEADLINE))
              .min(3)
              .max(15)
              .describe(`3-15 headlines, max ${MAX_HEADLINE} chars each`),
            descriptions: z
              .array(z.string().max(MAX_DESCRIPTION))
              .min(2)
              .max(4)
              .describe(`2-4 descriptions, max ${MAX_DESCRIPTION} chars each`),
            final_url: z.string().url().describe("Landing page URL"),
            path1: z.string().max(15).optional().describe("Display URL path 1"),
            path2: z.string().max(15).optional().describe("Display URL path 2"),
          }),
          approval: spendApproval(),
          async execute(
            {
              campaign_id,
              ad_group_name,
              headlines,
              descriptions,
              final_url,
              path1,
              path2,
            },
            ctx
          ) {
            const denied = requireSpendApprover(ctx)
            if (denied) return denied

            try {
              const groups = await client.listAdGroups(campaign_id)
              if (groups.length === 0) {
                return {
                  success: false as const,
                  error:
                    "That campaign has no ad groups yet. Create one with create_google_ads_ad_group first.",
                }
              }

              const match = ad_group_name
                ? groups.find((row) => {
                    const group = row.adGroup as Record<string, unknown> | undefined
                    return group?.name === ad_group_name
                  })
                : groups[0]

              if (!match) {
                return {
                  success: false as const,
                  error: `No ad group named "${ad_group_name}" in campaign ${campaign_id}`,
                }
              }

              const group = match.adGroup as Record<string, unknown>
              const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
              const adGroupResourceName =
                (group.resourceName as string | undefined) ??
                `customers/${customerId}/adGroups/${group.id}`

              const resourceName = await client.createResponsiveSearchAd({
                adGroupResourceName,
                headlines,
                descriptions,
                finalUrl: final_url,
                path1,
                path2,
              })

              return {
                success: true as const,
                ad_resource: resourceName,
                ad_group: group.name,
                headline_count: headlines.length,
                description_count: descriptions.length,
                final_url,
              }
            } catch (error) {
              return fail(error, "Failed to create ad")
            }
          },
        }),
      }
    },
  },
})
