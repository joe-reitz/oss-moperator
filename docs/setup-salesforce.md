# Connecting to Salesforce

This guide explains how to connect mOperator to your Salesforce instance. You'll enable the bot to query and analyze your Salesforce data right from Slack.

## Prerequisites

- Access to a Salesforce instance (any edition)
- Permission to create a Connected App
- mOperator deployed (local or Vercel)

## Step 1: Create a Connected App in Salesforce

1. Log in to your Salesforce org
2. Go to **Setup** (the gear icon in top-right)
3. In the search box, type **"App Manager"** and click it
4. Click **"New Connected App"**
5. Fill in the form:
   - **Connected App Name:** `mOperator`
   - **API Name:** Auto-fills as `mOperator` (ok to keep)
   - **Contact Email:** Your email

6. Under **"API (Enable OAuth Settings)"**:
   - Check the box: **"Enable OAuth Settings"**
   - **Callback URL:**
     - If local: `http://localhost:3000/api/integrations/salesforce/callback`
     - If deployed: `https://your-app.vercel.app/api/integrations/salesforce/callback`

   - **OAuth Scopes:** Click "Add" and select:
     - `api` — Access API
     - `refresh_token` — Get refresh tokens
     - `offline_access` — Stay authorized when user is offline

7. Click **"Save"**

A message confirms the app was created. You may need to wait 5–10 seconds for it to fully activate.

## Step 2: Get Your Client ID and Secret

1. Go back to **App Manager**
2. Find your **"mOperator"** app in the list
3. Click the dropdown next to it → **"View"**
4. Under **"API (Enable OAuth Settings)"**, click **"Reveal"** next to Client Secret
5. Copy:
   - **Client ID**
   - **Client Secret**

Add these to your `.env.local`:

```bash
SALESFORCE_CLIENT_ID=your_client_id_here
SALESFORCE_CLIENT_SECRET=your_client_secret_here
```

## Step 3: Run the OAuth Flow

The first time, you need to authorize mOperator to access Salesforce. This is a one-time setup.

### For Local Development

1. Make sure your app is running:
   ```bash
   npm run dev
   ```

2. In your browser, go to:
   ```
   http://localhost:3000/api/integrations/salesforce
   ```

3. You'll be redirected to Salesforce to log in and approve
4. After approval, you'll see your tokens displayed:
   - `access_token` (starts with `00D`)
   - `refresh_token` (long string)
   - `instance_url` (e.g., `https://yourcompany.salesforce.com`)

5. Copy these to your `.env.local`:
   ```bash
   SALESFORCE_ACCESS_TOKEN=your_access_token
   SALESFORCE_REFRESH_TOKEN=your_refresh_token
   SALESFORCE_INSTANCE_URL=https://yourcompany.salesforce.com
   ```

### For Deployed App

1. Navigate to your deployed app:
   ```
   https://your-app.vercel.app/api/integrations/salesforce
   ```

2. Follow the same process, and the tokens will be displayed
3. Copy to Vercel environment variables (see [Deploy to Vercel](deploy-to-vercel.md))

## Step 4: Verify the Connection

Once tokens are in place, restart your app:

```bash
npm run dev
```

Test the connection in Slack:

```
@mOperator show me my accounts
```

If it works, the Salesforce integration is connected!

## Data Dictionary (Optional)

If you want mOperator to understand your custom Salesforce fields, you can provide a data dictionary:

1. Create a Google Sheet with columns:
   - `API Name` (e.g., `Account__c`)
   - `Label` (e.g., `Custom Account`)
   - `Description` (e.g., `Stores custom account info`)
   - `Type` (e.g., `Text`)

2. Publish it as CSV (File → Share → Get shareable link, then add `&export=csv` to the end)
3. Add to `.env.local`:
   ```bash
   SFDC_DATA_DICTIONARY_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv
   ```

mOperator will use this to help users query the right fields.

## Troubleshooting

### "Invalid Client ID or Secret"
- Double-check you copied the IDs correctly
- Make sure you hit "Save" in App Manager after creating the app

### "Callback URL doesn't match"
- Ensure the callback URL in Salesforce matches your actual deployment URL
- For local dev: `http://localhost:3000/api/integrations/salesforce/callback`
- For Vercel: `https://your-vercel-domain.vercel.app/api/integrations/salesforce/callback`

### "Access token expired"
- The refresh token will automatically get a new access token
- If errors persist, run the OAuth flow again

### "mOperator doesn't respond to Salesforce queries"
- Check that `SALESFORCE_INSTANCE_URL` is set (without trailing slash)
- Verify the Connected App is still active in Salesforce App Manager
- Try a simple query: `@mOperator count accounts`

## Next Steps

1. Test querying your Salesforce data
2. (Optional) Set up Slack admin controls: add `ADMIN_SLACK_USER_IDS` to `.env.local` with comma-separated Slack user IDs
3. Try exporting data: `@mOperator show me active opportunities as csv`
