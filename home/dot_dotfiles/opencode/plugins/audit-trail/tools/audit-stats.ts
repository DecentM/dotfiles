import { tool } from '@opencode-ai/plugin'

import { getToolExecutionStore } from '../db/index'
import type { ToolStats } from '../db/repositories/tool-execution.repository'
import { formatDuration, formatNumber } from '../lib'

const formatStats = (stats: ToolStats): string => {
  const { totalExecutions, completedCount, failedCount, avgDurationMs } = stats

  if (totalExecutions === 0) {
    return '## Audit Statistics\n\nNo executions recorded yet.'
  }

  return `## Audit Statistics

| Metric | Value |
|--------|-------|
| Total Executions | ${formatNumber(totalExecutions)} |
| Completed | ${formatNumber(completedCount)} |
| Failed | ${formatNumber(failedCount)} |
| Avg Duration | ${formatDuration(avgDurationMs)} |`
}

export const audit_stats = tool({
  description:
    'Get overall tool execution statistics from the audit trail (total, completed, failed, average duration).',
  args: {},
  async execute() {
    try {
      const store = await getToolExecutionStore()
      const stats = await store.getToolStats()
      return formatStats(stats)
    } catch (error) {
      return `Error: Failed to get audit stats: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
