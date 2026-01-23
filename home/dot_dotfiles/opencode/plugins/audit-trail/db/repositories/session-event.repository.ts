import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import { SessionEvent } from '../entities/session-event.entity'
import { ToolExecution } from '../entities/tool-execution.entity'
import type {
  GetSessionLogsFilters,
  ISessionEvent,
  ISessionEventStore,
  SessionEventInput,
  TimelineEntry,
} from '../types'

// Re-export filter and result types from shared types for backwards compatibility
export type { GetSessionLogsFilters, TimelineEntry } from '../types'

// For backwards compatibility, alias the new input type
export type LogSessionEventData = SessionEventInput

export type SessionEventRepository = Repository<SessionEvent> & ISessionEventStore

export const getSessionEventRepository = async (): Promise<SessionEventRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getSessionEventStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(SessionEvent)

  return baseRepository.extend<ISessionEventStore>({
    /**
     * Record a session lifecycle event.
     */
    async logSessionEvent(data: SessionEventInput): Promise<ISessionEvent | null> {
      try {
        const event = this.create({
          sessionId: data.sessionId,
          eventType: data.eventType,
          details: data.details ?? null,
        })

        return await this.save(event)
      } catch {
        return null
      }
    },

    /**
     * Export session events with optional filters.
     */
    async getSessionLogs(filters?: GetSessionLogsFilters): Promise<ISessionEvent[]> {
      try {
        const qb = this.createQueryBuilder('event')

        if (filters?.startDate) {
          qb.andWhere('event.timestamp >= :startDate', {
            startDate: filters.startDate,
          })
        }

        if (filters?.endDate) {
          qb.andWhere('event.timestamp <= :endDate', {
            endDate: filters.endDate,
          })
        }

        if (filters?.sessionId) {
          qb.andWhere('event.sessionId = :sessionId', {
            sessionId: filters.sessionId,
          })
        }

        if (filters?.eventType) {
          qb.andWhere('event.eventType = :eventType', {
            eventType: filters.eventType,
          })
        }

        qb.orderBy('event.timestamp', 'DESC')

        if (filters?.limit) {
          qb.limit(filters.limit)
        }

        return await qb.getMany()
      } catch {
        return []
      }
    },

    /**
     * Get a unified chronological timeline for a session.
     */
    async getSessionTimeline(sessionId: string): Promise<TimelineEntry[]> {
      try {
        // Fetch tool executions for the session using existing connection
        const toolExecutions = await this.manager.connection
          .getRepository(ToolExecution)
          .createQueryBuilder('execution')
          .where('execution.sessionId = :sessionId', { sessionId })
          .getMany()

        // Fetch session events for the session
        const sessionEvents = await this.createQueryBuilder('event')
          .where('event.sessionId = :sessionId', { sessionId })
          .getMany()

        // Combine and sort by timestamp
        const timeline: TimelineEntry[] = [
          ...toolExecutions.map((execution) => ({
            type: 'tool' as const,
            timestamp: execution.timestamp,
            data: execution,
          })),
          ...sessionEvents.map((event) => ({
            type: 'session' as const,
            timestamp: event.timestamp,
            data: event,
          })),
        ]

        // Sort chronologically (ascending)
        timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

        return timeline
      } catch {
        return []
      }
    },
  })
}
