/**
 * Slack Slash Command Handler
 *
 * Endpoint: POST /api/slack/commands
 * Handles: /moperator <command> [args...]
 */

import { NextResponse } from 'next/server'
import type { SlackCommandPayload, CommandContext, CommandResponse } from './types'
import { getCommand } from './registry'
import { readVerifiedSlackBody } from '@/lib/slack-signature'

export async function POST(request: Request) {
  try {
    const verified = await readVerifiedSlackBody(request)
    if ('error' in verified) {
      return new NextResponse(verified.error, { status: verified.status })
    }
    const params = new URLSearchParams(verified.rawBody)
    const payload = Object.fromEntries(params.entries()) as unknown as SlackCommandPayload

    const parts = payload.text.trim().split(/\s+/).filter(Boolean)
    const subcommand = parts[0]?.toLowerCase() || 'help'
    const args = parts.slice(1)

    const ctx: CommandContext = {
      payload,
      args,
      rawArgs: parts.slice(1).join(' '),
      userId: payload.user_id,
      channelId: payload.channel_id,
      responseUrl: payload.response_url,
      triggerId: payload.trigger_id,
    }

    const handler = getCommand(subcommand)

    let response: CommandResponse

    if (handler) {
      response = await handler.handler(ctx)
    } else {
      response = {
        response_type: 'ephemeral',
        text: `Unknown command: \`${subcommand}\`\n\nRun \`/moperator help\` to see available commands.`,
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[SlashCommand] Error:', error)
    return NextResponse.json({
      response_type: 'ephemeral',
      text: `Something went wrong. Please try again.`,
    })
  }
}
