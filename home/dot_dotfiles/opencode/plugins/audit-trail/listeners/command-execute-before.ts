import { getCommandExecutionStore } from '../db/index'
import type { Hook } from '../types'

interface CommandExecuteBeforeInput {
  command: string
  sessionID: string
  arguments: string
}

interface CommandExecuteBeforeOutput {
  parts: unknown[]
}

export const commandExecuteBeforeListener: Hook<'command.execute.before'> =
  () =>
  async (input: CommandExecuteBeforeInput, output: CommandExecuteBeforeOutput): Promise<void> => {
    const store = await getCommandExecutionStore()

    await store.logCommandExecution({
      sessionId: input.sessionID,
      command: input.command,
      arguments: input.arguments,
      partsJson: JSON.stringify(output.parts),
    })
  }
