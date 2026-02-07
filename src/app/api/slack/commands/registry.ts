/**
 * Command Registry
 *
 * To add a new command, import the handler and add it to COMMANDS.
 */

import type { CommandHandler } from './types'
import { helpCommand } from './handlers/help'
import { bugCommand } from './handlers/bug'
import { featureCommand } from './handlers/feature'

const COMMANDS: CommandHandler[] = [
  helpCommand,
  bugCommand,
  featureCommand,
]

const registry = new Map<string, CommandHandler>()

for (const command of COMMANDS) {
  registry.set(command.name, command)
}

export function getCommandRegistry(): Map<string, CommandHandler> {
  return registry
}

export function getCommand(name: string): CommandHandler | undefined {
  return registry.get(name)
}

export function listCommands(): CommandHandler[] {
  return COMMANDS
}
