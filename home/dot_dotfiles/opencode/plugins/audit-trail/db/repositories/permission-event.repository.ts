import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import type { PermissionStatus } from '../entities/permission-event.entity'
import { PermissionEvent } from '../entities/permission-event.entity'

export interface LogPermissionEventData {
  sessionId: string
  permissionType: string
  resource?: string
  status: PermissionStatus
  detailsJson?: string
}

export interface GetPermissionEventsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  status?: PermissionStatus
  limit?: number
}

export interface PermissionEventRepositoryExtension {
  logPermissionEvent(data: LogPermissionEventData): Promise<PermissionEvent | null>
  getPermissionEvents(filters?: GetPermissionEventsFilters): Promise<PermissionEvent[]>
}

export type PermissionEventRepository = Repository<PermissionEvent> &
  PermissionEventRepositoryExtension

/**
 * Get the extended PermissionEvent repository.
 * Throws if database is not configured.
 */
export const getPermissionEventRepository = async (): Promise<PermissionEventRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getPermissionEventStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(PermissionEvent)

  return baseRepository.extend<PermissionEventRepositoryExtension>({
    async logPermissionEvent(data: LogPermissionEventData): Promise<PermissionEvent | null> {
      try {
        const event = this.create({
          sessionId: data.sessionId,
          permissionType: data.permissionType,
          resource: data.resource ?? null,
          status: data.status,
          detailsJson: data.detailsJson ?? null,
        })

        return await this.save(event)
      } catch {
        return null
      }
    },

    async getPermissionEvents(filters?: GetPermissionEventsFilters): Promise<PermissionEvent[]> {
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

        if (filters?.status) {
          qb.andWhere('event.status = :status', {
            status: filters.status,
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
  })
}
