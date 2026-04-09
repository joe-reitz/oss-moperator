# Connecting to Google Ads

This guide explains how to connect mOperator to your Google Ads account. You'll be able to manage campaigns, create ads, and track performance from Slack.

## Prerequisites

- A Google Ads account
- A Google Ads Manager (MCC) account
- A Google Cloud project with the Google Ads API enabled
- mOperator deployed (local or Vercel)

## Step 1: Create a Manager (MCC) Account

If you don't already have one, create a Google Ads Manager Account:

1. Go to [ads.google.com/home/tools/manager-accounts/](https://ads.google.com/home/tools/manager-accounts/)
2. Name it something like "Your Company MCC"
3. Select **"Manage my accounts"** as the primary use
4. Link your existing ad account: go to **Accounts > Sub-account settings > Link existing accounts** and enter your ad account's customer ID

## Step 2: Get a Developer Token

1. In the MCC, go to **Admin > API Center**
2. Request a developer token — you'll get one immediately at "Test Account" access level
3. For production use, apply for **Basic Access** (review takes 1-3 weeks)
4. Copy the developer token

## Step 3: Create Google Cloud OAuth Credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services > Library**, search for "Google Ads API" and enable it
4. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI:
     - Local: `http://localhost:3000/api/integrations/google-ads/callback`
     - Deployed: `https://your-app.vercel.app/api/integrations/google-ads/callback`
5. Copy the **Client ID** and **Client Secret**

## Step 4: Set Environment Variables

Add these to your `.env.local`:

```bash
GOOGLE_ADS_CLIENT_ID=your-client-id
GOOGLE_ADS_CLIENT_SECRET=your-client-secret
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
GOOGLE_ADS_CUSTOMER_ID=1234567890          # Your ad account ID (no dashes)
GOOGLE_ADS_LOGIN_CUSTOMER_ID=9876543210    # Your MCC account ID (no dashes)
```

## Step 5: Run the OAuth Flow

1. Start your app (`npm run dev` or deploy to Vercel)
2. Visit `http://localhost:3000/api/integrations/google-ads` (or your deployed URL)
3. Sign in with the Google account that has access to your ads account
4. On success, you'll see the access and refresh tokens — copy them to your `.env.local`:

```bash
GOOGLE_ADS_ACCESS_TOKEN=ya29...
GOOGLE_ADS_REFRESH_TOKEN=1//...
```

Tokens are also cached in Redis. The refresh token is long-lived; the access token auto-refreshes.

## Step 6: Test It

Try these prompts in Slack:

- `@mOperator list my Google Ads campaigns`
- `@mOperator how are our Google Ads performing this week?`
- `@mOperator what's the CPC on our campaigns this month?`

## Spend Safeguards

All operations that involve ad spend require explicit approval:

- **Create campaign** — always requires approval
- **Update budget** — always requires approval
- **Enable/pause campaign** — always requires approval
- **Create ad groups and ads** — always requires approval
- **New campaigns start PAUSED** — enabling requires a separate approval

Set `GROWTH_MARKETING_APPROVERS` to a comma-separated list of email addresses to restrict who can approve ad spend operations. If not set, no one can approve spend operations.

```bash
GROWTH_MARKETING_APPROVERS=growth-lead@company.com,marketing-manager@company.com
```

## Coming Soon

mOperator's ad platform framework is designed to support multiple networks. Future integrations planned:

- **LinkedIn Marketing** — Campaign management and analytics
- **Microsoft Advertising (Bing)** — Search campaign management
- **TikTok Marketing** — Campaign creation and performance tracking

Each follows the same pattern: feature-flagged, approval-gated, and manageable from Slack.
