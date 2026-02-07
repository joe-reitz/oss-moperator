/**
 * Slack Slash Command Types
 */

export interface SlackCommandPayload {
  token: string
  team_id: string
  team_domain: string
  channel_id: string
  channel_name: string
  user_id: string
  user_name: string
  command: string
  text: string
  api_app_id: string
  is_enterprise_install: string
  response_url: string
  trigger_id: string
}

export interface CommandContext {
  payload: SlackCommandPayload
  args: string[]
  rawArgs: string
  userId: string
  channelId: string
  responseUrl: string
  triggerId: string
}

export interface CommandResponse {
  text: string
  response_type?: 'in_channel' | 'ephemeral'
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
}

export interface SlackBlock {
  type: string
  text?: { type: string; text: string; emoji?: boolean }
  elements?: unknown[]
  accessory?: unknown
  [key: string]: unknown
}

export interface SlackAttachment {
  color?: string
  text?: string
  fields?: { title: string; value: string; short?: boolean }[]
  [key: string]: unknown
}

export interface CommandHandler {
  name: string
  description: string
  usage?: string
  examples?: string[]
  handler: (ctx: CommandContext) => Promise<CommandResponse>
}
