/**
 * Shared types for audit trail storage.
 * Both TypeORM entities and memory store must conform to these interfaces.
 * Adding a field here will cause type errors in both places until implemented.
 */

// ============================================================================
// Enum Types
// ============================================================================

export type ToolExecutionDecision = 'started' | 'completed' | 'failed'

export type SessionEventType =
  | 'created'
  | 'compacted'
  | 'deleted'
  | 'error'
  | 'idle'
  | 'event'
  | 'config'
  | 'chat_params'
  | 'chat_headers'

export type PermissionStatus = 'ask' | 'deny' | 'allow'

// ============================================================================
// Entity Interfaces - Core fields that any record must have
// ============================================================================

/** Core fields that any tool execution record must have */
export interface IToolExecution {
  id: number
  timestamp: Date
  sessionId: string
  messageId: string | null
  callId: string | null
  toolName: string
  agentId: string | null
  arguments: string | null
  decision: ToolExecutionDecision
  resultSummary: string | null
  durationMs: number | null
}

/** Core fields that any session event record must have */
export interface ISessionEvent {
  id: number
  timestamp: Date
  sessionId: string
  eventType: SessionEventType
  details: string | null
}

/** Core fields that any chat message record must have */
export interface IChatMessage {
  id: number
  timestamp: Date
  sessionId: string
  messageId: string | null
  agent: string | null
  providerId: string | null
  modelId: string | null
  variant: string | null
  messageContent: string | null
  partsJson: string | null
}

/** Core fields that any permission event record must have */
export interface IPermissionEvent {
  id: number
  timestamp: Date
  sessionId: string
  permissionType: string
  resource: string | null
  status: PermissionStatus
  detailsJson: string | null
}

/** Core fields that any command execution record must have */
export interface ICommandExecution {
  id: number
  timestamp: Date
  sessionId: string
  command: string
  arguments: string | null
  partsJson: string | null
}

// ============================================================================
// Input Types - For creating records (optional fields use ?, required fields are mandatory)
// These types are used when logging new entries - callers can omit optional fields
// ============================================================================

/** Input type for creating a tool execution (optional fields can be omitted) */
export interface ToolExecutionInput {
  sessionId: string
  messageId?: string | null
  callId?: string | null
  toolName: string
  agentId?: string | null
  arguments?: string | null
  decision: ToolExecutionDecision
  resultSummary?: string | null
  durationMs?: number | null
}

/** Input type for creating a session event (optional fields can be omitted) */
export interface SessionEventInput {
  sessionId: string
  eventType: SessionEventType
  details?: string | null
}

/** Input type for creating a chat message (optional fields can be omitted) */
export interface ChatMessageInput {
  sessionId: string
  messageId?: string | null
  agent?: string | null
  providerId?: string | null
  modelId?: string | null
  variant?: string | null
  messageContent?: string | null
  partsJson?: string | null
}

/** Input type for creating a permission event (optional fields can be omitted) */
export interface PermissionEventInput {
  sessionId: string
  permissionType: string
  resource?: string | null
  status: PermissionStatus
  detailsJson?: string | null
}

/** Input type for creating a command execution (optional fields can be omitted) */
export interface CommandExecutionInput {
  sessionId: string
  command: string
  arguments?: string | null
  partsJson?: string | null
}

// ============================================================================
// Filter Types
// ============================================================================

export interface GetLogsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  toolName?: string
  limit?: number
}

export interface GetSessionLogsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  eventType?: SessionEventType
  limit?: number
}

export interface GetChatMessagesFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  limit?: number
}

export interface GetPermissionEventsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  status?: PermissionStatus
  limit?: number
}

export interface GetCommandExecutionsFilters {
  startDate?: Date
  endDate?: Date
  sessionId?: string
  command?: string
  limit?: number
}

// ============================================================================
// Result Types
// ============================================================================

export interface ToolStats {
  totalExecutions: number
  completedCount: number
  failedCount: number
  avgDurationMs: number | null
}

export interface ToolUsageEntry {
  toolName: string
  executionCount: number
  avgDurationMs: number | null
}

export interface TimelineEntry {
  type: 'tool' | 'session'
  timestamp: Date
  data: IToolExecution | ISessionEvent
}

// ============================================================================
// Store Interfaces - Common interface for both DB and memory stores
// ============================================================================

/** Common store interface for tool executions */
export interface IToolExecutionStore {
  logToolExecution(data: ToolExecutionInput): Promise<IToolExecution | null>
  getLogs(filters?: GetLogsFilters): Promise<IToolExecution[]>
  getToolStats(): Promise<ToolStats>
  getToolUsage(topN?: number): Promise<ToolUsageEntry[]>
}

/** Common store interface for session events */
export interface ISessionEventStore {
  logSessionEvent(data: SessionEventInput): Promise<ISessionEvent | null>
  getSessionLogs(filters?: GetSessionLogsFilters): Promise<ISessionEvent[]>
  getSessionTimeline(sessionId: string): Promise<TimelineEntry[]>
}

/** Common store interface for chat messages */
export interface IChatMessageStore {
  logChatMessage(data: ChatMessageInput): Promise<IChatMessage | null>
  getChatMessages(filters?: GetChatMessagesFilters): Promise<IChatMessage[]>
}

/** Common store interface for permission events */
export interface IPermissionEventStore {
  logPermissionEvent(data: PermissionEventInput): Promise<IPermissionEvent | null>
  getPermissionEvents(filters?: GetPermissionEventsFilters): Promise<IPermissionEvent[]>
}

/** Common store interface for command executions */
export interface ICommandExecutionStore {
  logCommandExecution(data: CommandExecutionInput): Promise<ICommandExecution | null>
  getCommandExecutions(filters?: GetCommandExecutionsFilters): Promise<ICommandExecution[]>
}
