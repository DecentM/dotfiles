import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import { CommandExecution } from '../entities/command-execution.entity'

export interface LogCommandExecutionData {
  sessionId: string
  command: string
  arguments?: string
  partsJson?: string
}

export interface GetCommandExecutionsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  command?: string
  limit?: number
}

export interface CommandExecutionRepositoryExtension {
  logCommandExecution(data: LogCommandExecutionData): Promise<CommandExecution | null>
  getCommandExecutions(filters?: GetCommandExecutionsFilters): Promise<CommandExecution[]>
}

export type CommandExecutionRepository = Repository<CommandExecution> &
  CommandExecutionRepositoryExtension

/**
 * Get the extended CommandExecution repository.
 * Throws if database is not configured.
 */
export const getCommandExecutionRepository = async (): Promise<CommandExecutionRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getCommandExecutionStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(CommandExecution)

  return baseRepository.extend<CommandExecutionRepositoryExtension>({
    async logCommandExecution(data: LogCommandExecutionData): Promise<CommandExecution | null> {
      try {
        const execution = this.create({
          sessionId: data.sessionId,
          command: data.command,
          arguments: data.arguments ?? null,
          partsJson: data.partsJson ?? null,
        })

        return await this.save(execution)
      } catch {
        return null
      }
    },

    async getCommandExecutions(filters?: GetCommandExecutionsFilters): Promise<CommandExecution[]> {
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

        if (filters?.command) {
          qb.andWhere('execution.command = :command', {
            command: filters.command,
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
  })
}
