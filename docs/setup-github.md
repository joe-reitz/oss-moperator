# Connecting to GitHub

This guide explains how to connect mOperator to GitHub so the bot can fetch commits, releases, and other repository data.

## Prerequisites

- Access to a GitHub repository
- Permission to create Personal Access Tokens (or have someone with access create one for you)

## Step 1: Create a Personal Access Token

1. Go to [github.com](https://github.com) and log in
2. Click your **profile picture** in the top-right
3. Go to **"Settings"**
4. In the left sidebar, click **"Developer Settings"**
5. Click **"Personal access tokens"** → **"Fine-grained tokens"**
6. Click **"Generate new token"**
7. Fill in the form:
   - **Token name:** `mOperator`
   - **Expiration:** Choose "90 days" (you'll regenerate it periodically)
   - **Resource owner:** Your GitHub account or organization
   - **Repository access:** Select "Only select repositories" and choose your repo

8. Under **"Repository permissions"**, set:
   - **Contents:** Read-only (we only read commits and releases)

9. Click **"Generate token"**
10. **Copy the token** (you won't see it again) — it starts with `github_pat_`

## Step 2: Get Your Repository Name

You need the repository in `owner/repo` format:

- **Owner:** Your username or organization name
- **Repo:** The repository name

For example: `acme/marketing-site` or `vercel/next.js`

## Step 3: Add to Environment

Add these to your `.env.local`:

```bash
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxx
GITHUB_REPO=owner/repo
```

Replace:
- `github_pat_xxxxxxxxxxxxx` with your actual token
- `owner/repo` with your actual GitHub path

## Step 4: Test the Connection

Restart your app:

```bash
npm run dev
```

Test in Slack:

```
@mOperator what shipped this week?
```

or

```
@mOperator show me commits since Monday
```

If it works, you'll see recent commits listed with messages and authors.

## What mOperator Can Do With GitHub

### Query Commits

```
@mOperator latest commits
→ Shows recent commits with authors and messages

@mOperator what changed this week
→ Lists commits from the past 7 days

@mOperator commits from April 1 to April 15
→ Commits in a specific date range
```

### Use Cases

- **Release notes:** Query commits since the last release
- **Status updates:** See what the team shipped recently
- **Code reviews:** Check what changes went in this sprint

## Troubleshooting

### "Invalid token"
- Make sure you copied the entire token (starts with `github_pat_`)
- Verify it's a fine-grained token (not a classic token)
- Check the token hasn't expired in GitHub settings

### "Repository not found"
- Verify the format is `owner/repo` (case-sensitive)
- Check the repository is public or you have access to it
- Try a simple query: `@mOperator show commits` (no date filters)

### "Permission denied"
- The token needs "Contents: Read-only" permission
- Make sure the token's repository access includes your target repo
- Regenerate the token if needed

### "Bot doesn't respond to GitHub queries"
- Check both `GITHUB_TOKEN` and `GITHUB_REPO` are set
- Restart the app after changing env vars
- Check app logs for error details

## Token Expiration and Renewal

Fine-grained tokens expire after 90 days. When your token expires:

1. Go to GitHub → Settings → Developer Settings → Personal access tokens
2. Regenerate the token
3. Copy the new token
4. Update `.env.local` with the new token
5. Restart your app

## Limiting Commit History

By default, mOperator fetches the last 30 days of commits. To change this:

1. Edit `GITHUB_REPO` value (this is currently the main limit)
2. Or contact the development team to customize the fetch window

## Next Steps

1. Test a few queries to get comfortable with commit searches
2. (Optional) Set up Linear integration to link commits to issues
3. (Optional) Set up Salesforce integration for marketing data alongside code changes
