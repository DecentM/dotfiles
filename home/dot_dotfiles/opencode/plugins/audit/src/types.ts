/**
 * OpenCode Permission Audit Plugin - Type Definitions
 */

/**
 * Permission entry as stored in the database
 */
export interface AuditEntry {
  id: string;
  sessionId: string;
  messageId: string;
  callId?: string;
  type: string;
  pattern?: string | string[];
  title: string;
  metadata: Record<string, unknown>;
  initialStatus: "ask" | "allow" | "deny";
  userResponse?: "once" | "always" | "reject";
  createdAt: number;
  respondedAt?: number;
}

/**
 * Database row representation of an audit entry
 */
export interface AuditEntryRow {
  id: string;
  session_id: string;
  message_id: string;
  call_id: string | null;
  type: string;
  pattern: string | null;
  title: string;
  metadata: string | null;
  initial_status: string;
  user_response: string | null;
  created_at: number;
  responded_at: number | null;
}

/**
 * Node in the command hierarchy tree
 */
export interface HierarchyNode {
  command: string;
  level: number;
  totalCount: number;
  deniedCount: number;
  askedCount: number;
  allowedCount: number;
  denialRate: number;
  children: HierarchyNode[];
  lastSeen: number;
}

/**
 * Database row for hierarchy cache
 */
export interface HierarchyRow {
  command: string;
  parent: string | null;
  level: number;
  total_count: number;
  denied_count: number;
  asked_count: number;
  allowed_count: number;
  denial_rate: number;
  last_seen: number;
}

/**
 * Filters for querying the hierarchy
 */
export interface HierarchyFilters {
  type?: string;
  minDenialRate?: number;
  maxDepth?: number;
  startDate?: number;
  endDate?: number;
}

/**
 * Statistics result structure
 */
export interface StatsResult {
  totalPermissions: number;
  autoApproved: number;
  autoDenied: number;
  userApproved: number;
  userDenied: number;
  approvalRate: number;
  autoApprovalRate: number;
  byType: Record<string, TypeStats>;
  bySession: SessionStats[];
  topDenied: CommandStats[];
  topAllowed: CommandStats[];
}

/**
 * Statistics per permission type
 */
export interface TypeStats {
  total: number;
  denied: number;
  allowed: number;
  asked: number;
  denialRate: number;
}

/**
 * Statistics per session
 */
export interface SessionStats {
  sessionId: string;
  total: number;
  denied: number;
  allowed: number;
  asked: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Command-level statistics
 */
export interface CommandStats {
  command: string;
  count: number;
  type: string;
}

/**
 * Filters for statistics queries
 */
export interface StatsFilters {
  type?: string;
  sessionId?: string;
  startDate?: number;
  endDate?: number;
  groupBy?: "type" | "session" | "time";
}

/**
 * Filters for export operations
 */
export interface ExportFilters {
  format: "csv" | "json";
  type?: string;
  sessionId?: string;
  startDate?: number;
  endDate?: number;
  status?: "ask" | "allow" | "deny";
  limit?: number;
}

/**
 * Parsed command structure for hierarchy building
 */
export interface ParsedCommand {
  full: string;
  segments: string[];
  base: string;
}

/**
 * Session metadata for correlation
 */
export interface SessionMetadata {
  sessionId: string;
  agent?: string;
  startedAt: number;
  lastActivity: number;
  totalPermissions: number;
}

/**
 * Time range presets for filtering
 */
export type TimeRangePreset = "today" | "week" | "month" | "all";

/**
 * Helper to convert time preset to timestamp range
 */
export const getTimeRange = (
  preset: TimeRangePreset
): { start: number; end: number } => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  switch (preset) {
    case "today":
      return { start: now - day, end: now };
    case "week":
      return { start: now - 7 * day, end: now };
    case "month":
      return { start: now - 30 * day, end: now };
    case "all":
    default:
      return { start: 0, end: now };
  }
};
