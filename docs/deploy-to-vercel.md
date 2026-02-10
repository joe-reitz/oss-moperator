# Deploying mOperator to Vercel

This guide walks you through deploying mOperator to Vercel so your Slack bot is live 24/7. You have two options: click a button (easiest) or use the command line.

## Option 1: Deploy Button (Fastest)

1. Go to the [mOperator GitHub README](https://github.com/vercel/moperator#quick-start)
2. Click the **"Deploy with Vercel"** button
3. Sign in to Vercel (or create a free account)
4. Review the environment variables that will be pre-filled
5. Add any additional env vars you need (Salesforce, Linear, GitHub)
6. Click **"Deploy"**
7. Wait 2–5 minutes for deployment to finish
8. You'll get a live URL: `https://your-project-name.vercel.app`

That's it! Skip to **"Update URLs and Redeploy"** below.

## Option 2: Manual Deploy with Vercel CLI

### 1. Install Vercel CLI

```bash
npm install -g vercel
```

Or use `npx` (no installation needed):

```bash
npx vercel
```

### 2. Deploy

In your mOperator directory:

```bash
vercel
```

This will:
1. Ask you to link to a Vercel project (or create a new one)
2. Deploy your code to Vercel
3. Give you a live URL

### 3. Add Environment Variables

After deployment, set up environment variables in Vercel:

**Option A: Web Dashboard**
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your mOperator project
3. Go to **Settings** → **Environment Variables**
4. Add each variable:
   - `AI_GATEWAY_API_KEY` = (your [AI Gateway](https://vercel.com/docs/ai-gateway) key)
   - `AI_PROVIDER` = `anthropic` (or `openai`)
   - `SLACK_BOT_TOKEN` = `xoxb-...`
   - Other integrations as needed (Salesforce, Linear, GitHub)

5. Click **"Save"** after each

**Option B: CLI**
```bash
vercel env add
```

Follow the prompts to add variables.

### 4. Redeploy with Variables

After adding env vars, redeploy:

```bash
vercel
```

This ensures the new variables are active.

## Update URLs for Slack and Salesforce

Now that you have a live URL, update your Slack and Salesforce configurations.

### Update Slack App URLs

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select your mOperator app
3. Go to **"Event Subscriptions"**
4. Update **Request URL** to:
   ```
   https://your-vercel-domain.vercel.app/api/slack
   ```

5. Go to **"Slash Commands"**
6. Click **"/moperator"** to edit
7. Update **Request URL** to:
   ```
   https://your-vercel-domain.vercel.app/api/slack/commands
   ```

8. Click **"Save"** on each

### Update Salesforce Callback URL

1. Go to **Salesforce Setup** → **App Manager**
2. Find your **"mOperator"** app
3. Click the dropdown → **"Edit"**
4. Update **Callback URL** to:
   ```
   https://your-vercel-domain.vercel.app/api/integrations/salesforce/callback
   ```

5. Click **"Save"**
6. You may need to re-run the OAuth flow (see [Setup Salesforce](setup-salesforce.md))

## Optional: Set Up Redis for Slash Command State

If you want mOperator to remember command state across requests (recommended for reliability):

1. Go to [upstash.com](https://upstash.com)
2. Sign up (free tier available)
3. Create a Redis database
4. Copy the **REST API URL** and **REST API Token**
5. Add to Vercel env vars:
   ```
   UPSTASH_REDIS_REST_URL=https://...
   UPSTASH_REDIS_REST_TOKEN=...
   ```

6. Redeploy:
   ```bash
   vercel
   ```

## Verify Deployment

Once everything is set up:

1. Go to your Slack workspace
2. Test the bot:
   ```
   @mOperator hello
   ```

3. Test slash commands:
   ```
   /moperator help
   ```

4. Test integrations:
   ```
   @mOperator show me recent commits
   ```

If all responses work, you're live!

## View Logs

If something breaks, check Vercel logs:

```bash
vercel logs
```

Or use the web dashboard:
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your project
3. Go to **"Deployments"**
4. Click the latest deployment
5. Go to **"Logs"** to see errors

## Common Issues

### "Request URL failed to validate"
- Make sure your Vercel deployment is live (check the URL in a browser)
- Verify the URL is exactly correct in Slack settings
- Wait a few seconds and try again

### "Bot doesn't respond"
- Check that `SLACK_BOT_TOKEN` is set in Vercel env vars
- Verify the Event Subscriptions URL is correct
- Check Vercel logs for errors

### "Salesforce queries fail"
- Make sure `SALESFORCE_ACCESS_TOKEN` and `SALESFORCE_INSTANCE_URL` are set
- Verify the callback URL in Salesforce matches your Vercel domain
- You may need to re-authorize (run OAuth flow again)

### "Changes aren't showing up"
- Env vars only apply on redeployment
- After changing an env var, run:
  ```bash
  vercel
  ```

- Wait for the new deployment to complete

## Updating mOperator

To get the latest version:

```bash
git pull origin main
vercel
```

This pulls the latest code and redeploys.

## Cost

Vercel has a **free tier**:
- 100 GB bandwidth per month
- Unlimited deployments
- Perfect for small teams

As you grow, Vercel's paid tiers start at $20/month.

## Next Steps

1. Invite team members to use the bot
2. Share the setup guides for Salesforce, Linear, or GitHub as needed
3. Set up admin controls by adding user IDs to `ADMIN_SLACK_USER_IDS`
4. Monitor Vercel logs if issues arise
