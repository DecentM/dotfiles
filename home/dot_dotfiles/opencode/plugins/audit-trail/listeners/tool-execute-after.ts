/**
 * Tool execution "after" listener for audit-trail plugin.
 *
 * Logs the completion of tool executions, correlating with the
 * "before" listener to calculate duration.
 */

import { randomUUID } from 'node:crypto'

import { logToolExecution, updateToolExecution } from '../db'
import { createResultSummary } from '../lib'
import type { Hook } from '../types'

interface ToolExecuteAfterInput {
  sessionID: string
  callID: string
  tool: string
}

interface ToolExecuteAfterOutput {
  output?: string
  metadata?: Record<string, unknown>
}

export const toolExecuteAfterListener: Hook<'tool.execute.after'> = () => async (
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput
) => {
  // Determine if this was a failure based on explicit metadata checks
  const metadata = output.metadata as Record<string, unknown> | undefined
  const isFailure =
    metadata?.error === true ||
    (metadata?.exitCode !== undefined && metadata.exitCode !== 0) ||
    metadata?.success === false

  const time = Date.now()

  await logToolExecution({
    sessionId: input.sessionID,
    callId: input.callID,
    toolName: input.tool,
    output: createResultSummary(output.output ?? ''),
    state: isFailure ? 'failed' : 'completed',
    timestamp: time,
  })
}
