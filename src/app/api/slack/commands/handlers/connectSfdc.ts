import type { CommandContext, CommandHandler, CommandResponse } from "../types"
import { SFDC_USER_OAUTH_FEATURE_ENABLED } from "@/lib/integrations/salesforce/user-auth/connection"
import { createOAuthState } from "@/lib/integrations/salesforce/user-auth/oauth-state"
import { generatePkce } from "@/lib/integrations/salesforce/user-auth/pkce"
import { getUserSfdcToken } from "@/lib/integrations/salesforce/user-auth/store"

export const connectSfdcCommand: CommandHandler = {
  name: "connect-sfdc",
  description: "Connect your Salesforce account so mOperator acts in SFDC as you",
  usage: "/moperator connect-sfdc",
  examples: ["/moperator connect-sfdc"],

  async handler(ctx: CommandContext): Promise<CommandResponse> {
    if (!SFDC_USER_OAUTH_FEATURE_ENABLED) {
      return {
        response_type: "ephemeral",
        text: "Per-user Salesforce OAuth isn't enabled on this mOperator instance. Set `SFDC_USER_OAUTH_ENABLED=true` (see docs/sfdc-per-user-oauth.md).",
      }
    }

    const existing = await getUserSfdcToken(ctx.userId).catch(() => null)
    if (existing) {
      return {
        response_type: "ephemeral",
        text:
          `You're already connected to Salesforce as \`${existing.sfdcUsername}\`. ` +
          `Run \`/moperator disconnect-sfdc\` first if you want to reconnect under a different account.`,
      }
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!baseUrl) {
      return {
        response_type: "ephemeral",
        text: "NEXT_PUBLIC_APP_URL is not configured on the server. Ask whoever runs mOperator to set it.",
      }
    }

    const { verifier, challenge } = generatePkce()
    const nonce = await createOAuthState({
      slackUserId: ctx.userId,
      slackTeamId: ctx.payload.team_id,
      channelId: ctx.channelId,
      source: "connect-sfdc-command",
      codeVerifier: verifier,
      codeChallenge: challenge,
    })

    const connectUrl = `${baseUrl}/api/integrations/salesforce/connect?nonce=${nonce}`

    return {
      response_type: "ephemeral",
      text: "Click below to connect Salesforce — link expires in 10 minutes.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Connect Salesforce to mOperator*\n\n" +
              "After you click below, you'll go through Salesforce's standard OAuth screen. " +
              "Once you grant access, future actions you ask mOperator to do will be attributed to *you* in Salesforce instead of the shared service account.\n\n" +
              "_This link expires in 10 minutes and is single-use._",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Connect Salesforce", emoji: true },
              style: "primary",
              url: connectUrl,
              action_id: "open_sfdc_oauth",
            },
          ],
        },
      ],
    }
  },
}
