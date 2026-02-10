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
   - `users:read.email` — Get user email addresses (needed for approval workflow)
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
users:read.email
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

## Step 5: Enable Interactivity (for Approval Workflow)

If you want to use the approval workflow for Salesforce write operations, you need to enable interactivity so Slack can send button clicks to your app:

1. Click **"Interactivity & Shortcuts"** in the left sidebar
2. Toggle **"Interactivity"** to ON
3. In **"Request URL"**, enter:
   - **Deployed to Vercel:** `https://your-app.vercel.app/api/slack/interactions`
   - Replace `your-app` with your actual Vercel domain
4. Click **"Save Changes"**

This enables the Approve/Deny buttons that appear when a non-authorized user triggers a Salesforce write operation. See the [approval workflow](#approval-workflow) section below for details on configuring `AUTHORIZED_USER_EMAILS`.

## Step 6: Configure App Home

1. Click **"App Home"** in the left sidebar
2. Under **"Messages Tab"**, toggle **ON**
3. Enable these options:
   - **"Allow users to send messages"**
   - **"Show Tab"**

This lets users DM the bot directly.

## Step 7: Install the App to Your Workspace

1. Click **"Install to Workspace"** (or **"Reinstall"** if you made changes)
2. Review the permissions and click **"Allow"**
3. You'll be redirected back to Slack settings

## Step 8: Copy Your Bot Token

1. Go back to **"OAuth & Permissions"**
2. Under **"OAuth Tokens for Your Workspace"**, find **"Bot User OAuth Token"**
3. It starts with `xoxb-` — copy the entire token
4. Add it to your `.env.local`:

```bash
SLACK_BOT_TOKEN=xoxb-your-copied-token-here
```

## Step 9 (Optional): Get Your Bot User ID

This is only needed if you want the bot to access thread history:

1. In the left sidebar, go to **"Basic Information"**
2. Under **"App Credentials"**, find **"Bot User ID"**
3. It looks like `U12345678ABC`
4. Add it to your `.env.local`:

```bash
SLACK_BOT_USER_ID=U12345678ABC
```

## Step 10: Test the Bot

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

## Approval Workflow

mOperator includes an approval workflow for Salesforce write operations (create, update, delete, bulk update, add to campaign). When a non-authorized user asks the bot to perform a write operation, the bot posts an approval request with **Approve** and **Deny** buttons in the Slack thread. An authorized user must click Approve before the operation executes.

### Configuration

Add these to your `.env.local`:

```bash
# Comma-separated email addresses of authorized users (must match Slack profile emails)
AUTHORIZED_USER_EMAILS=admin@example.com,ops-lead@example.com

# Optional: Slack user group ID for @mentioning approvers in approval messages
# Find this in Slack Admin > User Groups > copy the group ID (e.g., S0123456789)
SLACK_APPROVER_GROUP_ID=S0123456789
```

You also need **Redis** configured for the approval store:

```bash
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

### How It Works

1. A non-authorized user asks the bot to perform a Salesforce write (e.g., "delete contact John Smith")
2. The bot posts a message in the thread: "Approval needed — Delete Contact record `003xxx`" with Approve/Deny buttons
3. An authorized user (whose email is in `AUTHORIZED_USER_EMAILS`) clicks **Approve** or **Deny**
4. If approved, the operation executes and the result is posted to the thread
5. If denied, the requester is notified in the thread
6. Approval requests expire after 30 minutes

### Notes

- If `AUTHORIZED_USER_EMAILS` is empty or not set, **all** write operations require approval (no one can self-approve)
- Authorized users' write operations execute immediately without approval
- Bulk operations have record limits: 1,500 for authorized users, 500 for non-authorized users
- Redis is required for the approval workflow — without it, write operations will return an error

## Next Steps

Once the Slack app is set up:
1. Go back to the main setup guide
2. Configure the AI provider (Anthropic or OpenAI)
3. Deploy your app to Vercel
4. Optionally set up Salesforce, Linear, or GitHub integrations
