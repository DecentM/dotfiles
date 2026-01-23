export type { DatabaseType } from './data-source'
export { closeDataSource, getDataSource } from './data-source'
export type {
  PermissionStatus,
  SessionEventType,
  ToolExecutionDecision,
} from './entities'

export {
  ChatMessage,
  CommandExecution,
  PermissionEvent,
  SessionEvent,
  ToolExecution,
} from './entities'
export type {
  ChatMessageStore,
  CommandExecutionStore,
  PermissionEventStore,
  SessionEventStore,
  ToolExecutionStore,
} from './memory-store'
export {
  isDatabaseConfigured,
  memoryChatMessageStore,
  memoryCommandExecutionStore,
  memoryPermissionEventStore,
  memorySessionEventStore,
  memoryToolExecutionStore,
} from './memory-store'
export type {
  ChatMessageRepository,
  CommandExecutionRepository,
  GetChatMessagesFilters,
  GetCommandExecutionsFilters,
  GetLogsFilters,
  GetPermissionEventsFilters,
  GetSessionLogsFilters,
  LogChatMessageData,
  LogCommandExecutionData,
  LogPermissionEventData,
  LogSessionEventData,
  LogToolExecutionData,
  PermissionEventRepository,
  SessionEventRepository,
  TimelineEntry,
  ToolExecutionRepository,
  ToolStats,
  ToolUsageEntry,
} from './repositories'
export {
  getChatMessageRepository,
  getCommandExecutionRepository,
  getPermissionEventRepository,
  getSessionEventRepository,
  getToolExecutionRepository,
} from './repositories'

/**
 * Get the tool execution store, using memory store as fallback when DB is not configured.
 */
export const getToolExecutionStore = async (): Promise<ToolExecutionStore> => {
  const { isDatabaseConfigured: isDbConfigured, memoryToolExecutionStore: memStore } = await import(
    './memory-store'
  )

  if (!isDbConfigured()) {
    return memStore
  }

  const { getToolExecutionRepository: getRepo } = await import('./repositories')
  return getRepo()
}

/**
 * Get the session event store, using memory store as fallback when DB is not configured.
 */
export const getSessionEventStore = async (): Promise<SessionEventStore> => {
  const { isDatabaseConfigured: isDbConfigured, memorySessionEventStore: memStore } = await import(
    './memory-store'
  )

  if (!isDbConfigured()) {
    return memStore
  }

  const { getSessionEventRepository: getRepo } = await import('./repositories')
  return getRepo()
}

/**
 * Get the chat message store, using memory store as fallback when DB is not configured.
 */
export const getChatMessageStore = async (): Promise<ChatMessageStore> => {
  const { isDatabaseConfigured: isDbConfigured, memoryChatMessageStore: memStore } = await import(
    './memory-store'
  )

  if (!isDbConfigured()) {
    return memStore
  }

  const { getChatMessageRepository: getRepo } = await import('./repositories')
  return getRepo()
}

/**
 * Get the permission event store, using memory store as fallback when DB is not configured.
 */
export const getPermissionEventStore = async (): Promise<PermissionEventStore> => {
  const { isDatabaseConfigured: isDbConfigured, memoryPermissionEventStore: memStore } =
    await import('./memory-store')

  if (!isDbConfigured()) {
    return memStore
  }

  const { getPermissionEventRepository: getRepo } = await import('./repositories')
  return getRepo()
}

/**
 * Get the command execution store, using memory store as fallback when DB is not configured.
 */
export const getCommandExecutionStore = async (): Promise<CommandExecutionStore> => {
  const { isDatabaseConfigured: isDbConfigured, memoryCommandExecutionStore: memStore } =
    await import('./memory-store')

  if (!isDbConfigured()) {
    return memStore
  }

  const { getCommandExecutionRepository: getRepo } = await import('./repositories')
  return getRepo()
}
