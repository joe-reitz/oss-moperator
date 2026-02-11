# Connect Marketo

Connect mOperator to Marketo so your team can search leads, manage static lists, trigger campaigns, and view programs and emails — all from Slack.

---

## Prerequisites

- A Marketo account with API access enabled
- Admin access to create API users and LaunchPoint services

## Step 1: Create an API-Only User

1. Log in to Marketo and go to **Admin**
2. Click **Users & Roles** in the left sidebar
3. Click the **Roles** tab and create a new role (e.g., `API Role`) with the following permissions:
   - Access API
   - Read-Only Lead
   - Read-Write Lead
   - Read-Only Assets
   - Read-Write Campaign (if you want to trigger campaigns)
4. Click the **Users** tab and click **Invite New User**
5. Fill in an email and name (e.g., `mOperator API`)
6. On the Permissions step, select **API Only** and assign the role you just created
7. Click **Send** to create the user

## Step 2: Create a LaunchPoint Custom Service

1. In Marketo Admin, click **LaunchPoint** in the left sidebar
2. Click **New > New Service**
3. Fill in the details:
   - **Display Name:** `mOperator`
   - **Service:** Custom
   - **API Only User:** Select the API user you created in Step 1
4. Click **Create**
5. Click on the newly created service to reveal the credentials
6. Copy the **Client ID** and **Client Secret**

## Step 3: Find Your REST API Endpoint

1. In Marketo Admin, click **Web Services** in the left sidebar
2. Under the **REST API** section, copy the **Endpoint URL**
   - It will look like: `https://123-ABC-456.mktorest.com`
   - Copy the base URL only (without `/rest` at the end)

## Step 4: Add Credentials to Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings > Environment Variables**
3. Add the following variables:

| Variable | Value |
| --- | --- |
| `MARKETO_CLIENT_ID` | Your LaunchPoint Client ID |
| `MARKETO_CLIENT_SECRET` | Your LaunchPoint Client Secret |
| `MARKETO_REST_ENDPOINT` | Your REST API endpoint URL (e.g., `https://123-ABC-456.mktorest.com`) |

4. Click **Save** and **redeploy** your project

## Step 5: Verify the Connection

In Slack, send a message to your mOperator bot:

```
@mOperator Show me all Marketo static lists
```

If everything is configured correctly, mOperator will return your Marketo lists.

## Example Commands

- `@mOperator Search Marketo for leads with email @acme.com`
- `@mOperator What fields are available on the Marketo lead object?`
- `@mOperator Show me all Marketo static lists`
- `@mOperator Add leads 12345 and 67890 to the webinar list`
- `@mOperator List all Marketo campaigns`
- `@mOperator Show me Marketo email assets`
- `@mOperator Trigger the welcome campaign for lead 12345`

## Troubleshooting

**"Marketo not configured" error**
- Make sure all three environment variables are set: `MARKETO_CLIENT_ID`, `MARKETO_CLIENT_SECRET`, and `MARKETO_REST_ENDPOINT`
- Redeploy after adding the variables

**"401 Unauthorized" or token errors**
- Double-check your Client ID and Client Secret from the LaunchPoint service
- Make sure the API-Only user is active and has the correct role
- Verify your REST endpoint URL is correct (no trailing `/rest`)

**"403 Forbidden" errors**
- The API user's role may be missing required permissions
- Go to Admin > Users & Roles and verify the role has the needed access

**Empty results**
- Marketo API results are paginated — very large datasets may require multiple queries
- Make sure the filter type and values match actual lead data

**Write operations require approval**
- By default, Marketo write operations (create/update leads, delete, list management, trigger campaigns) require approval from an authorized user
- Add your email to `AUTHORIZED_USER_EMAILS` in Vercel to bypass the approval workflow
