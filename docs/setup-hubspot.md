# Connect HubSpot

Connect mOperator to HubSpot so your team can search contacts, companies, and deals, manage lists, and create or update records — all from Slack.

---

## Prerequisites

- A HubSpot account (Free, Starter, Professional, or Enterprise)
- Admin access to create Private Apps in HubSpot

## Step 1: Create a Private App in HubSpot

1. Log in to your HubSpot account
2. Click the **Settings** gear icon in the top navigation bar
3. In the left sidebar, go to **Integrations > Private Apps**
4. Click **Create a private app**
5. Give it a name like `mOperator` and an optional description
6. Click the **Scopes** tab and enable the following scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`
   - `crm.lists.read`
   - `crm.lists.write`
   - `crm.objects.owners.read`
7. Click **Create app** and confirm
8. Copy the **Access token** shown on the next screen — you'll need it in the next step

> **Tip:** Store this token somewhere safe. You can always rotate it later from the Private Apps settings page.

## Step 2: Add the Token to Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings > Environment Variables**
3. Add the following variable:

| Variable | Value |
| --- | --- |
| `HUBSPOT_API_TOKEN` | Your Private App access token |

4. Click **Save** and **redeploy** your project

## Step 3: Verify the Connection

In Slack, send a message to your mOperator bot:

```
@mOperator Search HubSpot for contacts at Acme Corp
```

If everything is configured correctly, mOperator will return matching contacts from your HubSpot account.

## Example Commands

- `@mOperator Search HubSpot for contacts at Acme Corp`
- `@mOperator Show me all HubSpot deals closing this month`
- `@mOperator Create a new contact in HubSpot: John Smith, john@acme.com`
- `@mOperator Add contact 12345 to the newsletter list`
- `@mOperator Who are the HubSpot owners?`
- `@mOperator Search HubSpot companies in the SaaS industry`

## Troubleshooting

**"HubSpot not configured" error**
- Make sure `HUBSPOT_API_TOKEN` is set in your Vercel environment variables
- Redeploy after adding the variable

**"401 Unauthorized" error**
- Your Private App token may have expired or been revoked
- Go to HubSpot Settings > Private Apps, find your app, and generate a new token
- Update the `HUBSPOT_API_TOKEN` variable in Vercel and redeploy

**Missing data or empty results**
- Check that your Private App has the required scopes enabled
- Some HubSpot plans restrict API access — verify your plan includes API access

**Write operations require approval**
- By default, HubSpot write operations (create, update, delete) require approval from an authorized user
- Add your email to `AUTHORIZED_USER_EMAILS` in Vercel to bypass the approval workflow
