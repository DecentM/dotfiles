import type { Repository } from 'typeorm'

import { getDataSource } from '../data-source'
import { ChatMessage } from '../entities/chat-message.entity'

export interface LogChatMessageData {
  sessionId: string
  messageId?: string
  agent?: string
  providerId?: string
  modelId?: string
  variant?: string
  messageContent?: string
  partsJson?: string
}

export interface GetChatMessagesFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  limit?: number
}

export interface ChatMessageRepositoryExtension {
  logChatMessage(data: LogChatMessageData): Promise<ChatMessage | null>
  getChatMessages(filters?: GetChatMessagesFilters): Promise<ChatMessage[]>
}

export type ChatMessageRepository = Repository<ChatMessage> & ChatMessageRepositoryExtension

/**
 * Get the extended ChatMessage repository.
 * Throws if database is not configured.
 */
export const getChatMessageRepository = async (): Promise<ChatMessageRepository> => {
  const dataSource = await getDataSource()

  if (!dataSource) {
    throw new Error(
      'Database is not configured. Use getChatMessageStore() for automatic fallback to memory store.'
    )
  }

  const baseRepository = dataSource.getRepository(ChatMessage)

  return baseRepository.extend<ChatMessageRepositoryExtension>({
    async logChatMessage(data: LogChatMessageData): Promise<ChatMessage | null> {
      try {
        const message = this.create({
          sessionId: data.sessionId,
          messageId: data.messageId ?? null,
          agent: data.agent ?? null,
          providerId: data.providerId ?? null,
          modelId: data.modelId ?? null,
          variant: data.variant ?? null,
          messageContent: data.messageContent ?? null,
          partsJson: data.partsJson ?? null,
        })

        return await this.save(message)
      } catch {
        return null
      }
    },

    async getChatMessages(filters?: GetChatMessagesFilters): Promise<ChatMessage[]> {
      try {
        const qb = this.createQueryBuilder('message')

        if (filters?.startDate) {
          qb.andWhere('message.timestamp >= :startDate', {
            startDate: filters.startDate,
          })
        }

        if (filters?.endDate) {
          qb.andWhere('message.timestamp <= :endDate', {
            endDate: filters.endDate,
          })
        }

        if (filters?.sessionId) {
          qb.andWhere('message.sessionId = :sessionId', {
            sessionId: filters.sessionId,
          })
        }

        qb.orderBy('message.timestamp', 'DESC')

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
