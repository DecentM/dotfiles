/**
 * In-memory storage for audit trail when no database is configured.
 * Data is lost on restart - suitable for development/testing.
 */

import type { SessionEvent, SessionEventType } from './entities/session-event.entity'
import type { ToolExecution } from './entities/tool-execution.entity'
import type {
  GetLogsFilters,
  GetSessionLogsFilters,
  LogSessionEventData,
  LogToolExecutionData,
  TimelineEntry,
  ToolStats,
  ToolUsageEntry,
} from './repositories'

// Storage arrays
let toolExecutions: ToolExecution[] = []
let sessionEvents: SessionEvent[] = []
let nextToolId = 1
let nextSessionId = 1

// Tool Execution methods (mirror repository interface)
export const memoryToolExecutionStore = {
  logToolExecution: async (data: LogToolExecutionData): Promise<ToolExecution | null> => {
    const entry: ToolExecution = {
      id: nextToolId++,
      timestamp: new Date(),
      sessionId: data.sessionId,
      messageId: data.messageId ?? null,
      callId: data.callId ?? null,
      toolName: data.toolName,
      agentId: data.agentId ?? null,
      arguments: data.arguments ?? null,
      decision: data.decision,
      resultSummary: data.resultSummary ?? null,
      durationMs: data.durationMs ?? null,
    }
    toolExecutions.push(entry)
    return entry
  },

  getLogs: async (filters?: GetLogsFilters): Promise<ToolExecution[]> => {
    let results = [...toolExecutions]

    if (filters?.startDate) {
      results = results.filter((e) => e.timestamp >= filters.startDate!)
    }
    if (filters?.endDate) {
      results = results.filter((e) => e.timestamp <= filters.endDate!)
    }
    if (filters?.sessionId) {
      results = results.filter((e) => e.sessionId === filters.sessionId)
    }
    if (filters?.toolName) {
      results = results.filter((e) => e.toolName === filters.toolName)
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    if (filters?.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  },

  getToolStats: async (): Promise<ToolStats> => {
    const completedCount = toolExecutions.filter((e) => e.decision === 'completed').length
    const failedCount = toolExecutions.filter((e) => e.decision === 'failed').length
    const withDuration = toolExecutions.filter((e) => e.durationMs != null)
    const avgDurationMs =
      withDuration.length > 0
        ? withDuration.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / withDuration.length
        : null

    return {
      totalExecutions: toolExecutions.length,
      completedCount,
      failedCount,
      avgDurationMs,
    }
  },

  getToolUsage: async (topN = 10): Promise<ToolUsageEntry[]> => {
    const byTool = new Map<
      string,
      { count: number; totalDuration: number; durationCount: number }
    >()

    for (const exec of toolExecutions) {
      const existing = byTool.get(exec.toolName) ?? { count: 0, totalDuration: 0, durationCount: 0 }
      existing.count++
      if (exec.durationMs != null) {
        existing.totalDuration += exec.durationMs
        existing.durationCount++
      }
      byTool.set(exec.toolName, existing)
    }

    return Array.from(byTool.entries())
      .map(([toolName, data]) => ({
        toolName,
        executionCount: data.count,
        avgDurationMs: data.durationCount > 0 ? data.totalDuration / data.durationCount : null,
      }))
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, topN)
  },

  clear: () => {
    toolExecutions = []
    nextToolId = 1
  },
}

// Session Event methods (mirror repository interface)
export const memorySessionEventStore = {
  logSessionEvent: async (data: LogSessionEventData): Promise<SessionEvent | null> => {
    const entry: SessionEvent = {
      id: nextSessionId++,
      timestamp: new Date(),
      sessionId: data.sessionId,
      eventType: data.eventType as SessionEventType,
      details: data.details ?? null,
    }
    sessionEvents.push(entry)
    return entry
  },

  getSessionLogs: async (filters?: GetSessionLogsFilters): Promise<SessionEvent[]> => {
    let results = [...sessionEvents]

    if (filters?.startDate) {
      results = results.filter((e) => e.timestamp >= filters.startDate!)
    }
    if (filters?.endDate) {
      results = results.filter((e) => e.timestamp <= filters.endDate!)
    }
    if (filters?.sessionId) {
      results = results.filter((e) => e.sessionId === filters.sessionId)
    }
    if (filters?.eventType) {
      results = results.filter((e) => e.eventType === filters.eventType)
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    if (filters?.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  },

  getSessionTimeline: async (sessionId: string): Promise<TimelineEntry[]> => {
    const toolEvents = toolExecutions
      .filter((e) => e.sessionId === sessionId)
      .map((e) => ({ timestamp: e.timestamp, type: 'tool' as const, data: e }))

    const sessEvents = sessionEvents
      .filter((e) => e.sessionId === sessionId)
      .map((e) => ({ timestamp: e.timestamp, type: 'session' as const, data: e }))

    return [...toolEvents, ...sessEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )
  },

  clear: () => {
    sessionEvents = []
    nextSessionId = 1
  },
}

// Store interface types (subset of repository methods needed by tools/listeners)
export interface ToolExecutionStore {
  logToolExecution(data: LogToolExecutionData): Promise<ToolExecution | null>
  getLogs(filters?: GetLogsFilters): Promise<ToolExecution[]>
  getToolStats(): Promise<ToolStats>
  getToolUsage(topN?: number): Promise<ToolUsageEntry[]>
}

export interface SessionEventStore {
  logSessionEvent(data: LogSessionEventData): Promise<SessionEvent | null>
  getSessionLogs(filters?: GetSessionLogsFilters): Promise<SessionEvent[]>
  getSessionTimeline(sessionId: string): Promise<TimelineEntry[]>
}

/**
 * Check if database is configured via environment variables.
 */
export const isDatabaseConfigured = (): boolean => {
  const host = process.env.AUDIT_DB_HOST
  const username = process.env.AUDIT_DB_USERNAME
  return Boolean(host && username)
}
