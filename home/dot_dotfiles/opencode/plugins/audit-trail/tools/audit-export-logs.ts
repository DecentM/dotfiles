import { tool } from '@opencode-ai/plugin'
import type { ToolExecution } from '../db/entities/tool-execution.entity'
import { getToolExecutionStore } from '../db/index'
import { formatDuration, formatNumber, formatTimestamp, parseOptionalDate } from '../lib'

const formatLogEntry = (log: ToolExecution): string => {
  const timestamp = formatTimestamp(log.timestamp)
  const lines = [
    `### ${timestamp} - ${log.toolName}`,
    `- Session: ${log.sessionId}`,
    `- Decision: ${log.decision}`,
    `- Duration: ${formatDuration(log.durationMs)}`,
  ]

  if (log.agentId) {
    lines.push(`- Agent: ${log.agentId}`)
  }

  return lines.join('\n')
}

const formatLogs = (logs: ToolExecution[], totalCount: number): string => {
  if (logs.length === 0) {
    return '## Audit Logs\n\nNo log entries found matching the filters.'
  }

  const countInfo =
    totalCount > logs.length
      ? `showing ${formatNumber(logs.length)} of ${formatNumber(totalCount)}`
      : `${formatNumber(logs.length)} entries`

  const header = `## Audit Logs (${countInfo})\n`
  const entries = logs.map(formatLogEntry).join('\n\n')

  return `${header}\n${entries}`
}

export const audit_export_logs = tool({
  description:
    'Export audit logs with optional filters. Optional params: since (ISO timestamp), before (ISO timestamp), session_id, tool_name, limit (max results, default 1000)',
  args: {
    since: tool.schema.string().optional().describe('ISO timestamp to filter from'),
    before: tool.schema.string().optional().describe('ISO timestamp to filter until'),
    session_id: tool.schema.string().optional().describe('Filter by session ID'),
    tool_name: tool.schema.string().optional().describe('Filter by tool name'),
    limit: tool.schema.number().optional().describe('Maximum number of results (default 1000)'),
  },
  async execute(args) {
    try {
      const limit = args.limit ?? 1000
      const store = await getToolExecutionStore()
      const logs = await store.getLogs({
        startDate: parseOptionalDate(args.since) ?? undefined,
        endDate: parseOptionalDate(args.before) ?? undefined,
        sessionId: args.session_id,
        toolName: args.tool_name,
        limit,
      })

      // For the count info, we use logs.length as we don't have a separate count query
      // If logs.length equals limit, there might be more
      const totalCount = logs.length === limit ? limit + 1 : logs.length

      return formatLogs(logs, totalCount)
    } catch (error) {
      return `Error: Failed to export logs: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
