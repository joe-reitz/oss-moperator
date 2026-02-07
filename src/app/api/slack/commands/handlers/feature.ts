import { waitUntil } from "@vercel/functions"
import type { CommandContext, CommandResponse, CommandHandler } from '../types'
import { fileIssueFromMessage } from '@/lib/integrations/linear'

export const featureCommand: CommandHandler = {
  name: 'feature',
  description: 'File a feature request to Linear',
  usage: '/moperator feature <description>',
  examples: [
    '/moperator feature Add date filtering to reports',
    '/moperator feature Dark mode for the dashboard',
  ],

  async handler(ctx: CommandContext): Promise<CommandResponse> {
    if (!ctx.rawArgs) {
      return {
        response_type: 'ephemeral',
        text: 'Please describe the feature. Example: `/moperator feature Add date filtering to reports`',
      }
    }

    waitUntil(
      (async () => {
        try {
          const result = await fileIssueFromMessage(ctx.rawArgs, 'feature')

          if (result.success) {
            await fetch(ctx.responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_type: 'in_channel',
                text: `*Feature request filed:* <${result.url}|${result.identifier}> — ${result.title}`,
              }),
            })
          } else {
            await fetch(ctx.responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_type: 'ephemeral',
                text: `Failed to file feature request: ${result.error}`,
              }),
            })
          }
        } catch (error) {
          console.error('[SlashCommand] Feature filing error:', error)
          await fetch(ctx.responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'ephemeral',
              text: `Something went wrong. Please try again.`,
            }),
          })
        }
      })()
    )

    return { response_type: 'ephemeral', text: 'Filing feature request...' }
  },
}
