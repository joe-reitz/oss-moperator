import type { CommandContext, CommandHandler, CommandResponse } from "../types"
import { SFDC_USER_OAUTH_FEATURE_ENABLED } from "@/lib/integrations/salesforce/user-auth/connection"
import { getUserSfdcToken } from "@/lib/integrations/salesforce/user-auth/store"

function timeAgo(ts: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export const sfdcStatusCommand: CommandHandler = {
  name: "sfdc-status",
  description: "Show your current Salesforce connection (if any)",
  usage: "/moperator sfdc-status",
  examples: ["/moperator sfdc-status"],

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
        text:
          "You're *not connected* to Salesforce. Actions you ask mOperator to do are attributed to the shared service account.\n\n" +
          "Run `/moperator connect-sfdc` to attribute your actions to you instead.",
      }
    }

    return {
      response_type: "ephemeral",
      text:
        `*Salesforce connection:* \`${existing.sfdcUsername}\`\n` +
        `Connected ${timeAgo(existing.connectedAt)}, last used ${timeAgo(existing.lastUsedAt)}.\n` +
        `Token auto-expires after 90 days of inactivity. Use \`/moperator disconnect-sfdc\` to remove.`,
    }
  },
}
