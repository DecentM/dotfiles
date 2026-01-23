/**
 * Tool execution "before" listener for audit-trail plugin.
 *
 * Logs the start of tool executions and tracks them for correlation
 * with the "after" listener.
 */

import { logToolExecution } from '../db'
import type { Hook } from '../types'

interface ToolExecuteBeforeInput {
  sessionID: string
  callID: string
  tool: string
}

interface ToolExecuteBeforeOutput {
  args: unknown
}

export const toolExecuteBeforeListener: Hook<'tool.execute.before'> = () => async (
  input: ToolExecuteBeforeInput,
  output: ToolExecuteBeforeOutput
): Promise<void> => {
  const time = Date.now()

  await logToolExecution({
    sessionId: input.sessionID,
    callId: input.callID,
    toolName: input.tool,
    args: output.args, // json, but store as object (bson or something in db)
    state: 'started',
    timestamp: time,
  })
}
