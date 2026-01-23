import { getToolExecutionStore } from '../db/index'
import type { Hook } from '../types'

interface ToolExecuteBeforeInput {
  sessionID: string
  callID: string
  tool: string
  args?: unknown
}

interface ToolExecuteBeforeOutput {
  args: unknown
}

const serializeArgs = (args: unknown): string | null => {
  if (args === undefined || args === null) return null
  try {
    return JSON.stringify(args)
  } catch {
    return null
  }
}

export const toolExecuteBeforeListener: Hook<'tool.execute.before'> =
  () =>
  async (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput): Promise<void> => {
    const store = await getToolExecutionStore()

    // Args may be in input or output depending on SDK version
    const args = input.args ?? output.args

    await store.logToolExecution({
      sessionId: input.sessionID,
      callId: input.callID,
      toolName: input.tool,
      arguments: serializeArgs(args),
      decision: 'started',
    })
  }
