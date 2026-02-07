import { waitUntil } from "@vercel/functions"
import type { CommandContext, CommandResponse, CommandHandler } from '../types'
import { fileIssueFromMessage } from '@/lib/integrations/linear'

export const bugCommand: CommandHandler = {
  name: 'bug',
  description: 'File a bug report to Linear',
  usage: '/moperator bug <description>',
  examples: [
    '/moperator bug Dashboard spinner never stops',
    '/moperator bug CSV export is broken for large files',
  ],

  async handler(ctx: CommandContext): Promise<CommandResponse> {
    if (!ctx.rawArgs) {
      return {
        response_type: 'ephemeral',
        text: 'Please describe the bug. Example: `/moperator bug Dashboard spinner never stops`',
      }
    }

    waitUntil(
      (async () => {
        try {
          const result = await fileIssueFromMessage(ctx.rawArgs, 'bug')

          if (result.success) {
            await fetch(ctx.responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_type: 'in_channel',
                text: `*Bug filed:* <${result.url}|${result.identifier}> — ${result.title}`,
              }),
            })
          } else {
            await fetch(ctx.responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_type: 'ephemeral',
                text: `Failed to file bug: ${result.error}`,
              }),
            })
          }
        } catch (error) {
          console.error('[SlashCommand] Bug filing error:', error)
          await fetch(ctx.responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'ephemeral',
              text: `Something went wrong filing the bug. Please try again.`,
            }),
          })
        }
      })()
    )

    return { response_type: 'ephemeral', text: 'Filing bug report...' }
  },
}
