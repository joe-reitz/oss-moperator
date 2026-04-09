import type { Integration } from "../types"
import { googleAdsTools } from "./tools"

export const googleAdsIntegration: Integration = {
  name: "Google Ads",
  description: "Paid search and display campaign management",
  capabilities: [
    "List and inspect Google Ads campaigns with performance metrics",
    "Create new campaigns with daily budgets (requires approval)",
    "Create ad groups and responsive search ads with headlines and descriptions (requires approval)",
    "Update campaign budgets (requires approval)",
    "Enable or pause campaigns (requires approval)",
    "Query performance metrics (impressions, clicks, cost, conversions) by date range",
    "Get direct links to the Google Ads dashboard",
  ],
  examples: [
    "List my Google Ads campaigns",
    "How are our Google Ads performing this week?",
    "Create a search campaign for Next.js Conf with $200/day budget",
    "Create an ad with headlines: 'Deploy to Vercel', 'Ship Faster'",
    "Pause the brand campaign",
    "What's our Google Ads CPC this month?",
  ],
  isConfigured: () => !!(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  ),
  getTools: () => googleAdsTools,
}

export { getAuthorizationUrl, exchangeCodeForTokens, validateState } from "./client"
