import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import { ToolExecution } from '../entities/tool-execution.entity'
import type {
  GetLogsFilters,
  IToolExecution,
  IToolExecutionStore,
  ToolExecutionInput,
  ToolStats,
  ToolUsageEntry,
} from '../types'

// Re-export filter and result types from shared types for backwards compatibility
export type { GetLogsFilters, ToolStats, ToolUsageEntry } from '../types'

// For backwards compatibility, alias the new input type
export type LogToolExecutionData = ToolExecutionInput

export type ToolExecutionRepository = Repository<ToolExecution> & IToolExecutionStore

/**
 * Get the extended ToolExecution repository.
 * Throws if database is not configured - use getToolExecutionStore() instead for automatic fallback.
 */
export const getToolExecutionRepository = async (): Promise<ToolExecutionRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getToolExecutionStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(ToolExecution)

  return baseRepository.extend<IToolExecutionStore>({
    /**
     * Record a tool execution event.
     */
    async logToolExecution(data: ToolExecutionInput): Promise<IToolExecution | null> {
      try {
        const execution = this.create({
          sessionId: data.sessionId,
          messageId: data.messageId ?? null,
          callId: data.callId ?? null,
          toolName: data.toolName,
          agentId: data.agentId ?? null,
          arguments: data.arguments ?? null,
          decision: data.decision,
          resultSummary: data.resultSummary ?? null,
          durationMs: data.durationMs ?? null,
        })

        return await this.save(execution)
      } catch {
        return null
      }
    },

    /**
     * Export tool execution logs with optional filters.
     */
    async getLogs(filters?: GetLogsFilters): Promise<IToolExecution[]> {
      try {
        const qb = this.createQueryBuilder('execution')

        if (filters?.startDate) {
          qb.andWhere('execution.timestamp >= :startDate', {
            startDate: filters.startDate,
          })
        }

        if (filters?.endDate) {
          qb.andWhere('execution.timestamp <= :endDate', {
            endDate: filters.endDate,
          })
        }

        if (filters?.sessionId) {
          qb.andWhere('execution.sessionId = :sessionId', {
            sessionId: filters.sessionId,
          })
        }

        if (filters?.toolName) {
          qb.andWhere('execution.toolName = :toolName', {
            toolName: filters.toolName,
          })
        }

        qb.orderBy('execution.timestamp', 'DESC')

        if (filters?.limit) {
          qb.limit(filters.limit)
        }

        return await qb.getMany()
      } catch {
        return []
      }
    },

    /**
     * Get overall execution metrics.
     */
    async getToolStats(): Promise<ToolStats> {
      try {
        const result = await this.createQueryBuilder('execution')
          .select('COUNT(*)', 'totalExecutions')
          .addSelect(
            "SUM(CASE WHEN execution.decision = 'completed' THEN 1 ELSE 0 END)",
            'completedCount'
          )
          .addSelect(
            "SUM(CASE WHEN execution.decision = 'failed' THEN 1 ELSE 0 END)",
            'failedCount'
          )
          .addSelect('AVG(execution.durationMs)', 'avgDurationMs')
          .getRawOne()

        return {
          totalExecutions: Number.parseInt(result?.totalExecutions ?? '0', 10),
          completedCount: Number.parseInt(result?.completedCount ?? '0', 10),
          failedCount: Number.parseInt(result?.failedCount ?? '0', 10),
          avgDurationMs: result?.avgDurationMs ? Number.parseFloat(result.avgDurationMs) : null,
        }
      } catch {
        return {
          totalExecutions: 0,
          completedCount: 0,
          failedCount: 0,
          avgDurationMs: null,
        }
      }
    },

    /**
     * Get per-tool breakdown of usage.
     */
    async getToolUsage(topN = 10): Promise<ToolUsageEntry[]> {
      try {
        const results = await this.createQueryBuilder('execution')
          .select('execution.toolName', 'toolName')
          .addSelect('COUNT(*)', 'executionCount')
          .addSelect('AVG(execution.durationMs)', 'avgDurationMs')
          .groupBy('execution.toolName')
          .orderBy('executionCount', 'DESC')
          .limit(topN)
          .getRawMany()

        return results.map((row) => ({
          toolName: row.toolName,
          executionCount: Number.parseInt(row.executionCount, 10),
          avgDurationMs: row.avgDurationMs ? Number.parseFloat(row.avgDurationMs) : null,
        }))
      } catch {
        return []
      }
    },
  })
}
