/**
 * Database management and audit logging for the docker tool.
 *
 * This module is the ONLY place that contains SQL queries.
 * All other modules should use the exported API functions.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Decision, LogEntry } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface OverallStats {
  total: number;
  allowed: number;
  denied: number;
  avgDurationMs: number | null;
}

export interface PatternStats {
  patternMatched: string | null;
  decision: string;
  count: number;
}

export interface OperationCount {
  operation: string;
  count: number;
}

export interface LogRow {
  timestamp: string;
  sessionId: string | null;
  operation: string;
  target: string | null;
  paramsJson: string | null;
  patternMatched: string | null;
  decision: string;
  resultSummary: string | null;
  durationMs: number | null;
}

export interface StatsFilter {
  since?: Date;
  decision?: Decision;
}

export interface LogsFilter {
  since?: Date;
  decision?: Decision;
  limit?: number;
}

// =============================================================================
// Database Setup
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "docker.db");

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
      db.run(`
        CREATE TABLE IF NOT EXISTS docker_operation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          session_id TEXT,
          message_id TEXT,
          operation TEXT NOT NULL,
          target TEXT,
          params_json TEXT,
          pattern_matched TEXT,
          decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
          result_summary TEXT,
          duration_ms INTEGER
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_docker_timestamp ON docker_operation_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_docker_decision ON docker_operation_log(decision)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_docker_operation ON docker_operation_log(operation)`);
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
// Audit Logging
// =============================================================================

export const logOperation = (entry: LogEntry): number => {
  const db = dbManager.get();
  const result = db.run(
    `INSERT INTO docker_operation_log
     (session_id, message_id, operation, target, params_json, pattern_matched, decision, result_summary, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId ?? null,
      entry.messageId ?? null,
      entry.operation,
      entry.target ?? null,
      entry.paramsJson ?? null,
      entry.patternMatched,
      entry.decision,
      entry.resultSummary ?? null,
      entry.durationMs ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
};

export const updateLogEntry = (
  id: number,
  resultSummary: string,
  durationMs: number
): void => {
  const db = dbManager.get();
  db.run(
    `UPDATE docker_operation_log SET result_summary = ?, duration_ms = ? WHERE id = ?`,
    [resultSummary, durationMs, id]
  );
};

// =============================================================================
// Statistics Queries
// =============================================================================

/**
 * Get overall operation statistics (totals, allowed/denied counts, avg duration).
 */
export const getOverallStats = (filter: StatsFilter = {}): OverallStats => {
  const db = dbManager.get();
  const { conditions, params } = buildWhereClause(filter);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const row = db
    .query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denied,
        AVG(CASE WHEN decision = 'allow' THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM docker_operation_log
      ${whereClause}`
    )
    .get(...params) as {
    total: number;
    allowed: number;
    denied: number;
    avg_duration_ms: number | null;
  };

  return {
    total: row.total,
    allowed: row.allowed,
    denied: row.denied,
    avgDurationMs: row.avg_duration_ms,
  };
};

/**
 * Get pattern usage statistics grouped by pattern and decision.
 */
export const getPatternStats = (filter: StatsFilter = {}, limit = 15): PatternStats[] => {
  const db = dbManager.get();
  const { conditions, params } = buildWhereClause(filter);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT
        pattern_matched,
        decision,
        COUNT(*) as count
      FROM docker_operation_log
      ${whereClause}
      GROUP BY pattern_matched, decision
      ORDER BY count DESC
      LIMIT ?`
    )
    .all(...params, limit) as Array<{
    pattern_matched: string | null;
    decision: string;
    count: number;
  }>;

  return rows.map((row) => ({
    patternMatched: row.pattern_matched,
    decision: row.decision,
    count: row.count,
  }));
};

/**
 * Get top denied operations with their counts.
 */
export const getTopDeniedOperations = (since?: Date, limit = 10): OperationCount[] => {
  const db = dbManager.get();
  const params: (string | number)[] = [];

  let query = `
    SELECT operation, COUNT(*) as count
    FROM docker_operation_log
    WHERE decision = 'deny'
  `;

  if (since) {
    query += ` AND timestamp >= ?`;
    params.push(since.toISOString());
  }

  query += `
    GROUP BY operation
    ORDER BY count DESC
    LIMIT ?
  `;
  params.push(limit);

  return db.query(query).all(...params) as OperationCount[];
};

// =============================================================================
// Log Export Queries
// =============================================================================

/**
 * Get operation log entries for export.
 */
export const getLogs = (filter: LogsFilter = {}): LogRow[] => {
  const db = dbManager.get();
  const { since, decision, limit = 1000 } = filter;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (since) {
    conditions.push("timestamp >= ?");
    params.push(since.toISOString());
  }

  if (decision) {
    conditions.push("decision = ?");
    params.push(decision);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT timestamp, session_id, operation, target, params_json, pattern_matched, decision, result_summary, duration_ms
      FROM docker_operation_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?`
    )
    .all(...params, limit) as Array<{
    timestamp: string;
    session_id: string | null;
    operation: string;
    target: string | null;
    params_json: string | null;
    pattern_matched: string | null;
    decision: string;
    result_summary: string | null;
    duration_ms: number | null;
  }>;

  return rows.map((row) => ({
    timestamp: row.timestamp,
    sessionId: row.session_id,
    operation: row.operation,
    target: row.target,
    paramsJson: row.params_json,
    patternMatched: row.pattern_matched,
    decision: row.decision,
    resultSummary: row.result_summary,
    durationMs: row.duration_ms,
  }));
};

// =============================================================================
// Helpers
// =============================================================================

const buildWhereClause = (
  filter: StatsFilter
): { conditions: string[]; params: (string | null)[] } => {
  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (filter.since) {
    conditions.push("timestamp >= ?");
    params.push(filter.since.toISOString());
  }

  if (filter.decision) {
    conditions.push("decision = ?");
    params.push(filter.decision);
  }

  return { conditions, params };
};
