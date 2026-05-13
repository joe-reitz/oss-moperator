import type { CommandContext, CommandHandler, CommandResponse } from "../types"
import { SFDC_USER_OAUTH_FEATURE_ENABLED } from "@/lib/integrations/salesforce/user-auth/connection"
import { deleteUserSfdcToken, getUserSfdcToken } from "@/lib/integrations/salesforce/user-auth/store"

export const disconnectSfdcCommand: CommandHandler = {
  name: "disconnect-sfdc",
  description: "Remove your stored Salesforce connection from mOperator",
  usage: "/moperator disconnect-sfdc",
  examples: ["/moperator disconnect-sfdc"],

  async handler(ctx: CommandContext): Promise<CommandResponse> {
    if (!SFDC_USER_OAUTH_FEATURE_ENABLED) {
      return {
        response_type: "ephemeral",
        text: "Per-user Salesforce OAuth isn't enabled on this mOperator instance.",
      }
    }

    const existing = await getUserSfdcToken(ctx.userId).catch(() => null)
    if (!existing) {
      return {
        response_type: "ephemeral",
        text: "You don't have a stored Salesforce connection. Use `/moperator connect-sfdc` to set one up.",
      }
    }

    await deleteUserSfdcToken(ctx.userId)

    return {
      response_type: "ephemeral",
      text:
        `Disconnected from Salesforce (\`${existing.sfdcUsername}\`). ` +
        `Future actions will fall back to the shared service account. ` +
        `Run \`/moperator connect-sfdc\` to reconnect anytime.`,
    }
  },
}
