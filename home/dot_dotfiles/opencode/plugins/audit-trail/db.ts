/**
 * Database management and audit logging for the audit-trail plugin.
 *
 * This module is the ONLY place that contains SQL queries.
 * All other modules should use the exported API functions.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  LogsFilter,
  SessionLogEntry,
  SessionLogRow,
  SessionTimelineEntry,
  StatsFilter,
  ToolExecutionLogEntry,
  ToolExecutionLogRow,
  ToolStats,
  ToolUsage,
} from "./types";

// =============================================================================
// Database Setup
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "audit-trail.db");

/**
 * Database connection manager with cleanup support.
 */
export const dbManager = (() => {
  let db: Database | null = null;

  const get = (): Database => {
    if (!db) {
      if (!existsSync(AUDIT_DIR)) {
        mkdirSync(AUDIT_DIR, { recursive: true });
      }
      db = new Database(DB_PATH);

      // Create tool_execution_log table
      db.run(`
        CREATE TABLE IF NOT EXISTS tool_execution_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          session_id TEXT,
          message_id TEXT,
          call_id TEXT,
          tool_name TEXT NOT NULL,
          agent TEXT,
          args_json TEXT,
          decision TEXT CHECK (decision IN ('started', 'completed', 'failed')),
          result_summary TEXT,
          duration_ms INTEGER
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tool_timestamp ON tool_execution_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_execution_log(tool_name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tool_session_id ON tool_execution_log(session_id)`);

      // Create session_log table
      db.run(`
        CREATE TABLE IF NOT EXISTS session_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('created', 'compacted', 'deleted', 'error', 'idle')),
          details_json TEXT
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_session_id ON session_log(session_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_session_event_type ON session_log(event_type)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_session_timestamp ON session_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_session_id_timestamp ON session_log(session_id, timestamp)`);
    }
    return db;
  };

  const close = (): void => {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors during shutdown
      }
      db = null;
    }
  };

  return { get, close };
})();

// Register cleanup handlers for graceful shutdown
process.on("exit", () => dbManager.close());
process.on("SIGINT", () => {
  dbManager.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  dbManager.close();
  process.exit(0);
});

// =============================================================================
// Tool Execution Logging
// =============================================================================

/**
 * Log a tool execution entry. Returns the row ID for later updates.
 * Returns 0 if logging fails.
 */
export const logToolExecution = (entry: ToolExecutionLogEntry): number => {
  try {
    const db = dbManager.get();
    const result = db.run(
      `INSERT INTO tool_execution_log
       (timestamp, session_id, message_id, call_id, tool_name, agent, args_json, decision, result_summary, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        entry.sessionId ?? null,
        entry.messageId ?? null,
        entry.callId ?? null,
        entry.toolName,
        entry.agent ?? null,
        entry.argsJson ?? null,
        entry.decision,
        entry.resultSummary ?? null,
        entry.durationMs ?? null,
      ]
    );
    return Number(result.lastInsertRowid);
  } catch (error) {
    console.error("[audit-trail] Database error in logToolExecution:", error);
    return 0;
  }
};

/**
 * Update a tool execution log entry with completion details.
 */
export const updateToolExecution = (
  id: number,
  decision: "completed" | "failed",
  resultSummary: string,
  durationMs: number
): void => {
  try {
    const db = dbManager.get();
    db.run(
      `UPDATE tool_execution_log SET decision = ?, result_summary = ?, duration_ms = ? WHERE id = ?`,
      [decision, resultSummary, durationMs, id]
    );
  } catch (error) {
    console.error("[audit-trail] Database error in updateToolExecution:", error);
  }
};

// =============================================================================
// Session Event Logging
// =============================================================================

/**
 * Log a session event.
 * Returns 0 if logging fails.
 */
export const logSessionEvent = (entry: SessionLogEntry): number => {
  try {
    const db = dbManager.get();
    const result = db.run(
      `INSERT INTO session_log (timestamp, session_id, event_type, details_json) VALUES (?, ?, ?, ?)`,
      [Date.now(), entry.sessionId, entry.eventType, entry.detailsJson ?? null]
    );
    return Number(result.lastInsertRowid);
  } catch (error) {
    console.error("[audit-trail] Database error in logSessionEvent:", error);
    return 0;
  }
};

// =============================================================================
// Statistics Queries
// =============================================================================

/**
 * Get overall tool execution statistics.
 */
export const getToolStats = (filter: StatsFilter = {}): ToolStats => {
  const db = dbManager.get();
  const { conditions, params } = buildToolWhereClause(filter);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const row = db
    .query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN decision = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN decision IN ('completed', 'failed') THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM tool_execution_log
      ${whereClause}`
    )
    .get(...params) as {
    total: number;
    completed: number;
    failed: number;
    avg_duration_ms: number | null;
  };

  return {
    total: row.total,
    completed: row.completed,
    failed: row.failed,
    avgDurationMs: row.avg_duration_ms,
  };
};

/**
 * Get tool usage statistics grouped by tool name.
 */
export const getToolUsage = (filter: StatsFilter = {}, limit = 15): ToolUsage[] => {
  const db = dbManager.get();
  const { conditions, params } = buildToolWhereClause(filter);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT
        tool_name,
        COUNT(*) as count,
        AVG(CASE WHEN decision IN ('completed', 'failed') THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM tool_execution_log
      ${whereClause}
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT ?`
    )
    .all(...params, limit) as Array<{
    tool_name: string;
    count: number;
    avg_duration_ms: number | null;
  }>;

  return rows.map((row) => ({
    toolName: row.tool_name,
    count: row.count,
    avgDurationMs: row.avg_duration_ms,
  }));
};

/**
 * Get a timeline of all events for a specific session.
 */
export const getSessionTimeline = (sessionId: string): SessionTimelineEntry[] => {
  const db = dbManager.get();

  // Get tool executions for this session
  const toolRows = db
    .query(
      `SELECT timestamp, tool_name, decision, result_summary, duration_ms
       FROM tool_execution_log
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    )
    .all(sessionId) as Array<{
    timestamp: number;
    tool_name: string;
    decision: string;
    result_summary: string | null;
    duration_ms: number | null;
  }>;

  // Get session events for this session
  const sessionRows = db
    .query(
      `SELECT timestamp, event_type, details_json
       FROM session_log
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    )
    .all(sessionId) as Array<{
    timestamp: number;
    event_type: string;
    details_json: string | null;
  }>;

  // Combine and sort by timestamp
  const timeline: SessionTimelineEntry[] = [
    ...toolRows.map((row) => ({
      timestamp: row.timestamp,
      type: "tool_execution" as const,
      toolName: row.tool_name,
      decision: row.decision as "started" | "completed" | "failed",
      resultSummary: row.result_summary ?? undefined,
      durationMs: row.duration_ms,
    })),
    ...sessionRows.map((row) => ({
      timestamp: row.timestamp,
      type: "session_event" as const,
      eventType: row.event_type as "created" | "compacted" | "deleted" | "error" | "idle",
      detailsJson: row.details_json,
    })),
  ];

  // Sort by timestamp (numeric comparison for unix timestamps)
  timeline.sort((a, b) => a.timestamp - b.timestamp);

  return timeline;
};

// =============================================================================
// Log Export Queries
// =============================================================================

/**
 * Get tool execution log entries with optional filters.
 */
export const getLogs = (filter: LogsFilter = {}): ToolExecutionLogRow[] => {
  const db = dbManager.get();
  const { since, before, sessionId, toolName, limit = 1000 } = filter;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (since) {
    conditions.push("timestamp >= ?");
    params.push(since.getTime());
  }

  if (before) {
    conditions.push("timestamp <= ?");
    params.push(before.getTime());
  }

  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }

  if (toolName) {
    conditions.push("tool_name = ?");
    params.push(toolName);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT id, timestamp, session_id, message_id, call_id, tool_name, agent, args_json, decision, result_summary, duration_ms
       FROM tool_execution_log
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(...params, limit) as Array<{
    id: number;
    timestamp: number;
    session_id: string | null;
    message_id: string | null;
    call_id: string | null;
    tool_name: string;
    agent: string | null;
    args_json: string | null;
    decision: string;
    result_summary: string | null;
    duration_ms: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id,
    messageId: row.message_id,
    callId: row.call_id,
    toolName: row.tool_name,
    agent: row.agent,
    argsJson: row.args_json,
    decision: row.decision as "started" | "completed" | "failed",
    resultSummary: row.result_summary,
    durationMs: row.duration_ms,
  }));
};

/**
 * Get session log entries with optional filters.
 */
export const getSessionLogs = (sessionId?: string, limit = 1000): SessionLogRow[] => {
  const db = dbManager.get();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT id, timestamp, session_id, event_type, details_json
       FROM session_log
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(...params, limit) as Array<{
    id: number;
    timestamp: number;
    session_id: string;
    event_type: string;
    details_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id,
    eventType: row.event_type as "created" | "compacted" | "deleted" | "error" | "idle",
    detailsJson: row.details_json,
  }));
};

// =============================================================================
// Helpers
// =============================================================================

const buildToolWhereClause = (
  filter: StatsFilter
): { conditions: string[]; params: (string | number | null)[] } => {
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter.since) {
    conditions.push("timestamp >= ?");
    params.push(filter.since.getTime());
  }

  if (filter.before) {
    conditions.push("timestamp <= ?");
    params.push(filter.before.getTime());
  }

  if (filter.sessionId) {
    conditions.push("session_id = ?");
    params.push(filter.sessionId);
  }

  if (filter.toolName) {
    conditions.push("tool_name = ?");
    params.push(filter.toolName);
  }

  return { conditions, params };
};
