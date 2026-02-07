# Connecting Project Management Tools

mOperator can connect to project management tools so your team can file bugs and feature requests directly from Slack. This guide covers **Linear** as the built-in integration. The same pattern can be adapted for Asana, Monday.com, Jira, or any PM tool with an API — see [Adding Integrations](adding-integrations.md) for how to build your own.

## Linear Setup

This section walks you through connecting mOperator to Linear.

## Prerequisites

- Access to a Linear workspace
- Permission to create API keys
- Your team's Linear key (e.g., `ENG`, `MOPS`)

## Step 1: Create a Linear API Key

1. Log in to your Linear workspace at [linear.app](https://linear.app)
2. Click your **avatar** in the top-right corner
3. Go to **"Settings"**
4. In the sidebar, click **"API"** (under Account section)
5. Click **"Create Key"**
6. Give it a name (e.g., "mOperator")
7. Click **"Create API Key"**
8. Copy the key (it starts with `lin_api_`)

## Step 2: Find Your Team Key

You need your Linear team's key to configure which team receives issues.

**Option A: From URL**
1. Go to your Linear workspace
2. Click on any team project
3. Look at the URL: `https://linear.app/[workspace]/team/[TEAM_KEY]`
4. The team key is the capitalized part (e.g., `MOPS`, `ENG`)

**Option B: From Team Settings**
1. In Linear, go to **Settings** → **Teams**
2. Click on your team
3. The **"Identifier"** field shows the team key

## Step 3: Add to Environment

Add these to your `.env.local`:

```bash
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
LINEAR_TEAM_NAME=MOPS
```

Replace `MOPS` with your actual team key.

## Step 4: Test the Connection

Restart your app:

```bash
npm run dev
```

Test in Slack:

```
/moperator bug Dashboard spinner never stops
```

Or use the shorthand:

```
@mOperator bug: navigation menu is broken
```

If successful, an issue will be created in Linear with an auto-enriched title and description.

## How mOperator Uses Linear

### Automatic Issue Filing

When a user files a bug or feature request, mOperator:
1. Takes the description you provide
2. Uses AI to create a polished title
3. Adds a structured description with context
4. Files the issue in Triage status
5. Posts a link back to Slack

**Examples:**

```
@mOperator bug: dashboards take forever to load
→ Files to Linear with title: "Optimize dashboard load performance"
```

```
/moperator feature Add dark mode to reports
→ Files feature request and links back
```

### Query Issues

You can also ask mOperator to query your Linear issues:

```
@mOperator show me issues in triage
@mOperator what's assigned to me
@mOperator any bugs created this week
```

## Troubleshooting

### "Invalid API key"
- Double-check the API key starts with `lin_api_`
- Make sure you copied the entire string
- Try regenerating the key in Linear settings

### "Unknown team"
- Verify the `LINEAR_TEAM_NAME` matches your team's identifier
- Check it in Linear URL or Settings → Teams
- It should be uppercase (e.g., `MOPS` not `mops`)

### "Issues file but bot doesn't respond"
- Check that `LINEAR_API_KEY` is set correctly
- Restart the app after changing env vars
- Try a simple query: `@mOperator list teams`

### "Bot doesn't create issues with /moperator command"
- Verify the Linear integration is configured (check env vars)
- Make sure the command is registered: `/moperator bug` or `/moperator feature`
- Check app logs for error details

## Multiple Teams

Currently, mOperator files issues to a single team. If you need to route issues to different teams:

1. You can run multiple instances of mOperator with different `LINEAR_TEAM_NAME` values
2. Or ask the team to extend the integration — see [Adding Integrations](adding-integrations.md)

## Next Steps

1. Try filing a few issues to get comfortable with the workflow
2. (Optional) Set up Salesforce integration to query opportunities while filing bugs
3. (Optional) Set up GitHub integration to link commits to issues
