# Setting Up the Slack App

This guide walks you through creating a Slack app and connecting it to mOperator. Even if you're not a developer, you can complete these steps by following along carefully.

## Step 1: Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Choose **"From scratch"**
4. Give your app a name (e.g., "mOperator")
5. Select the Slack workspace you want to use
6. Click **"Create App"**

You should now see your app's settings page.

## Step 2: Configure OAuth Scopes

mOperator needs specific permissions to read messages and send responses:

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll down to **"Scopes"** → **"Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** and add these scopes one by one:
   - `app_mentions:read` — Read when the bot is mentioned
   - `chat:write` — Send messages
   - `files:read` — Read attached files
   - `files:write` — Upload files
   - `im:history` — Read direct messages
   - `users:read` — Get user information
   - `channels:history` — Read channel messages
   - `groups:history` — Read private channel messages
   - `commands` — Enable slash commands

Your scopes list should look like this:

```
app_mentions:read
chat:write
commands
files:read
files:write
groups:history
channels:history
im:history
users:read
```

## Step 3: Enable Event Subscriptions

1. Click **"Event Subscriptions"** in the left sidebar
2. Toggle **"Enable Events"** to ON
3. In **"Request URL"**, enter your app's URL:
   - **Local development:** Not applicable (use proxy or skip this)
   - **Deployed to Vercel:** `https://your-app.vercel.app/api/slack`
   - Replace `your-app` with your actual Vercel domain

4. Once the URL is verified, scroll down to **"Subscribe to bot events"**
5. Click **"Add Bot User Event"** and select:
   - `app_mention` — Bot was mentioned
   - `message.im` — Direct message to bot

## Step 4: Create Slash Commands

1. Click **"Slash Commands"** in the left sidebar
2. Click **"Create New Command"**
3. Fill in:
   - **Command:** `/moperator`
   - **Request URL:** `https://your-app.vercel.app/api/slack/commands` (or your local dev URL)
   - **Short Description:** "mOperator AI assistant"
   - **Usage Hint:** `bug|feature|help <text>`
4. Click **"Save"**

## Step 5: Configure App Home

1. Click **"App Home"** in the left sidebar
2. Under **"Messages Tab"**, toggle **ON**
3. Enable these options:
   - **"Allow users to send messages"**
   - **"Show Tab"**

This lets users DM the bot directly.

## Step 6: Install the App to Your Workspace

1. Click **"Install to Workspace"** (or **"Reinstall"** if you made changes)
2. Review the permissions and click **"Allow"**
3. You'll be redirected back to Slack settings

## Step 7: Copy Your Bot Token

1. Go back to **"OAuth & Permissions"**
2. Under **"OAuth Tokens for Your Workspace"**, find **"Bot User OAuth Token"**
3. It starts with `xoxb-` — copy the entire token
4. Add it to your `.env.local`:

```bash
SLACK_BOT_TOKEN=xoxb-your-copied-token-here
```

## Step 8 (Optional): Get Your Bot User ID

This is only needed if you want the bot to access thread history:

1. In the left sidebar, go to **"Basic Information"**
2. Under **"App Credentials"**, find **"Bot User ID"**
3. It looks like `U12345678ABC`
4. Add it to your `.env.local`:

```bash
SLACK_BOT_USER_ID=U12345678ABC
```

## Step 9: Test the Bot

1. Go to your Slack workspace
2. In any channel or DM, mention the bot: `@mOperator say hello`
3. The bot should respond

## Troubleshooting

### "Request URL failed to validate"
- Make sure your app is deployed and the URL is correct
- If developing locally, you can skip this and deploy first, then come back to enable events

### "Bot doesn't respond to messages"
- Check that you've installed the app to your workspace
- Verify all scopes are added (especially `app_mentions:read` and `chat:write`)
- Make sure the `SLACK_BOT_TOKEN` is set in your `.env.local`

### "Can't use slash commands"
- Confirm `/moperator` command was created in Slash Commands settings
- Check that the Request URL points to `/api/slack/commands`
- Reinstall the app to your workspace after making changes

## Next Steps

Once the Slack app is set up:
1. Go back to the main setup guide
2. Configure the AI provider (Anthropic or OpenAI)
3. Deploy your app to Vercel
4. Optionally set up Salesforce, Linear, or GitHub integrations
