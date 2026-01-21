/**
 * Type definitions for the audit-trail plugin.
 */

// =============================================================================
// Tool Execution Types
// =============================================================================

export type ToolDecision = "started" | "completed" | "failed";

export interface ToolExecutionLogEntry {
  sessionId?: string;
  messageId?: string;
  callId?: string;
  toolName: string;
  agent?: string;
  argsJson?: string;
  decision: ToolDecision;
  resultSummary?: string;
  durationMs?: number;
}

export interface ToolExecutionLogRow {
  id: number;
  timestamp: string;
  sessionId: string | null;
  messageId: string | null;
  callId: string | null;
  toolName: string;
  agent: string | null;
  argsJson: string | null;
  decision: ToolDecision;
  resultSummary: string | null;
  durationMs: number | null;
}

// =============================================================================
// Session Event Types
// =============================================================================

export type SessionEventType = "created" | "compacted" | "deleted" | "error" | "idle";

export interface SessionLogEntry {
  sessionId: string;
  eventType: SessionEventType;
  detailsJson?: string;
}

export interface SessionLogRow {
  id: number;
  timestamp: string;
  sessionId: string;
  eventType: SessionEventType;
  detailsJson: string | null;
}

// =============================================================================
// Filter Types
// =============================================================================

export interface StatsFilter {
  since?: Date;
  sessionId?: string;
  toolName?: string;
}

export interface LogsFilter {
  since?: Date;
  sessionId?: string;
  toolName?: string;
  limit?: number;
}

// =============================================================================
// Query Result Types
// =============================================================================

export interface ToolStats {
  total: number;
  completed: number;
  failed: number;
  avgDurationMs: number | null;
}

export interface ToolUsage {
  toolName: string;
  count: number;
  avgDurationMs: number | null;
}

export interface SessionTimelineEntry {
  timestamp: string;
  type: "tool_execution" | "session_event";
  toolName?: string;
  eventType?: SessionEventType;
  decision?: ToolDecision;
  resultSummary?: string;
  durationMs?: number | null;
  detailsJson?: string | null;
}
