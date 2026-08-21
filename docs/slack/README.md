# Slack app manifest

Paste [`manifest.json`](manifest.json) (or [`manifest.yaml`](manifest.yaml)) into
**api.slack.com/apps → Create New App → From a manifest**, replacing
`YOUR-DOMAIN` in the three URLs.

Every scope and event here is required by something in `agent/channels/slack.ts`.
The table below says which, so you can remove what you do not want rather than
guessing.

## Replace before pasting

| Placeholder | Becomes |
| --- | --- |
| `https://YOUR-DOMAIN/eve/v1/slack` | the agent's Slack route — used for **both** events and interactivity |
| `https://YOUR-DOMAIN/api/admin/signin/callback` | the admin sign-in callback, for `/chat`, `/console`, `/analytics` |

For local development, tunnel to your dev server (`ngrok http 3000`) and use the
tunnel host. Slack cannot reach `localhost`.

## Not using this at all?

If you run `npx eve add channel/slack` and choose **Vercel Connect**, Connect
creates and manages the Slack app, the bot token, request verification, and
rotation for you — no manifest, and no Slack secrets in your environment. That is
the recommended path.

Use this manifest for the portable-credentials path: self-hosted, non-Vercel, or
when you want to own the app yourself.

## What each scope is for

| Bot scope | Needed by |
| --- | --- |
| `app_mentions:read` | `onAppMention` — the basic "@mOperator …" |
| `chat:write` | every reply |
| `im:history` | `onDirectMessage` — DMing the agent |
| `im:write` | delivering a private Salesforce sign-in link as a DM |
| `channels:history` | `onMessage` — follow-ups in a thread without re-mentioning, and `threadContext` |
| `groups:history` | the same, in private channels |
| `users:read` | resolving who is talking |
| **`users:read.email`** | **the approver check, and Salesforce write attribution** |
| `files:read` | reading an attached CSV — list import needs this |
| `files:write` | attaching exports and cleaned lists to replies |
| `reactions:read` | the `:bug:` reaction that files an issue |

`users:read.email` is the one to not remove. Without it no email resolves, so
**every caller is treated as a non-approver** and **every Salesforce write is
refused** for lack of attribution — with nothing appearing misconfigured.
`npm run agent:doctor` checks for exactly this.

| User scope | Needed by |
| --- | --- |
| `openid`, `email`, `profile` | Sign in with Slack for the admin pages |

The user scopes are only for the browser sign-in. Drop them if you are running
Slack-only and never open `/chat` or `/console` — you can also drop
`redirect_urls` then.

| Event | Needed by |
| --- | --- |
| `app_mention` | mentions |
| `message.im` | DMs |
| `message.channels` | unmentioned thread follow-ups, and `/new` |
| `message.groups` | the same, in private channels |
| `app_home_opened` | the Home tab |
| `reaction_added` | the `:bug:` reaction |

## Safe to remove

- `reaction_added` + `reactions:read` — if you do not want the `:bug:` shortcut.
- `app_home_opened` + `home_tab_enabled` — if you do not want the Home tab.
- `message.groups` + `groups:history` — if the agent stays out of private channels.
- `message.channels` + `channels:history` — then every follow-up needs a fresh
  `@mention`, and `/new` stops working.
- The `user` scopes and `redirect_urls` — if you never use the browser pages.

## After creating the app

1. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`)
   to `SLACK_BOT_TOKEN`.
2. **Basic Information → App Credentials**: copy the **Signing Secret** to
   `SLACK_SIGNING_SECRET`, and the **Client ID / Client Secret** to
   `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.
3. Slack requires you to **verify the Request URL manually** when it comes from a
   manifest — open **Event Subscriptions** and confirm it shows *Verified*. Your
   deployment has to be live and reachable for that to pass.
4. Invite the bot to a channel: `/invite @moperator`.
5. Run `npm run agent:doctor` and check the Slack line.

## Optional: the typing indicator

eve shows "Thinking…" and "Working…" through Slack's
`assistant.threads.setStatus`, which needs the Agents & AI Apps feature and the
`assistant:write` scope. Failures are swallowed, so **the agent works fine
without it** — you just get no progress indicator while it thinks.

This is deliberately not in the manifest. Slack's manifest reference notes that
new apps must use `features.agent_view` rather than `assistant_view`, and that
adopting it is **irreversible** — not something to enable by pasting a file.
Turn it on in the app's own settings if you want it.
