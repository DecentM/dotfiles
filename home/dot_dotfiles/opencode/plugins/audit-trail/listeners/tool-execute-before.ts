import { getToolExecutionRepository } from '../db/index'
import type { Hook } from '../types'

interface ToolExecuteBeforeInput {
  sessionID: string
  callID: string
  tool: string
}

interface ToolExecuteBeforeOutput {
  args: unknown
}

export const toolExecuteBeforeListener: Hook<'tool.execute.before'> =
  () =>
  async (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput): Promise<void> => {
    const repo = await getToolExecutionRepository()

    await repo.logToolExecution({
      sessionId: input.sessionID,
      callId: input.callID,
      toolName: input.tool,
      arguments: JSON.stringify(output.args),
      decision: 'started',
    })
  }
