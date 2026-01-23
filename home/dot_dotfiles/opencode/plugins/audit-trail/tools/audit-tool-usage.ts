import { tool } from '@opencode-ai/plugin'

import { getToolExecutionStore } from '../db/index'
import type { ToolUsageEntry } from '../db/repositories/tool-execution.repository'
import { formatDuration, formatNumber } from '../lib'

const formatToolUsage = (usage: ToolUsageEntry[], limit: number): string => {
  if (usage.length === 0) {
    return '## Tool Usage\n\nNo tool usage data found.'
  }

  const header = `## Tool Usage (Top ${limit})

| Tool | Executions | Avg Duration |
|------|------------|--------------|`

  const rows = usage
    .map(
      (entry) =>
        `| ${entry.toolName} | ${formatNumber(entry.executionCount)} | ${formatDuration(entry.avgDurationMs)} |`
    )
    .join('\n')

  return `${header}\n${rows}`
}

export const audit_tool_usage = tool({
  description:
    'Get tool usage breakdown from the audit trail. Optional param: limit (max results, default 15)',
  args: {
    limit: tool.schema.number().optional().describe('Maximum number of results (default 15)'),
  },
  async execute(args) {
    try {
      const limit = args.limit ?? 15
      const store = await getToolExecutionStore()
      const usage = await store.getToolUsage(limit)
      return formatToolUsage(usage, limit)
    } catch (error) {
      return `Error: Failed to get tool usage: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
