import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import type { SessionEventType } from '../entities/session-event.entity'
import { SessionEvent } from '../entities/session-event.entity'
import { ToolExecution } from '../entities/tool-execution.entity'

export interface LogSessionEventData {
  sessionId: string
  eventType: SessionEventType
  details?: string
}

export interface GetSessionLogsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  eventType?: SessionEventType
  limit?: number
}

export interface TimelineEntry {
  type: 'tool' | 'session'
  timestamp: Date
  data: ToolExecution | SessionEvent
}

export interface SessionEventRepositoryExtension {
  logSessionEvent(data: LogSessionEventData): Promise<SessionEvent | null>
  getSessionLogs(filters?: GetSessionLogsFilters): Promise<SessionEvent[]>
  getSessionTimeline(sessionId: string): Promise<TimelineEntry[]>
}

export type SessionEventRepository = Repository<SessionEvent> & SessionEventRepositoryExtension

export const getSessionEventRepository = async (): Promise<SessionEventRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getSessionEventStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(SessionEvent)

  return baseRepository.extend<SessionEventRepositoryExtension>({
    /**
     * Record a session lifecycle event.
     */
    async logSessionEvent(data: LogSessionEventData): Promise<SessionEvent | null> {
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
    async getSessionLogs(filters?: GetSessionLogsFilters): Promise<SessionEvent[]> {
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
