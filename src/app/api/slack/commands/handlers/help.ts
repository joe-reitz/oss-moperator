import type { CommandContext, CommandResponse, CommandHandler } from '../types'
import { getCommandRegistry } from '../registry'

export const helpCommand: CommandHandler = {
  name: 'help',
  description: 'Show available commands',
  usage: '/moperator help [command]',
  examples: ['/moperator help', '/moperator help bug'],

  async handler(ctx: CommandContext): Promise<CommandResponse> {
    const registry = getCommandRegistry()
    const specificCommand = ctx.args[0]

    if (specificCommand) {
      const cmd = registry.get(specificCommand)
      if (!cmd) {
        return {
          response_type: 'ephemeral',
          text: `Unknown command: \`${specificCommand}\`\n\nRun \`/moperator help\` to see available commands.`,
        }
      }

      let text = `*${cmd.name}*\n${cmd.description}`
      if (cmd.usage) text += `\n\n*Usage:*\n\`${cmd.usage}\``
      if (cmd.examples && cmd.examples.length > 0) {
        text += `\n\n*Examples:*\n${cmd.examples.map(e => `• \`${e}\``).join('\n')}`
      }

      return { response_type: 'ephemeral', text }
    }

    const commands = Array.from(registry.values())
    const commandList = commands.map(cmd => `• \`${cmd.name}\` - ${cmd.description}`).join('\n')

    return {
      response_type: 'ephemeral',
      text: `*mOperator Commands*\n\n${commandList}\n\nRun \`/moperator help <command>\` for details.`,
    }
  },
}
