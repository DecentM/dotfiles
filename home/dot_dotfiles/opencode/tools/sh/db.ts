/**
 * Database management and audit logging for the sh tool.
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

export interface CommandCount {
  command: string;
  count: number;
}

export interface LogRow {
  timestamp: string;
  sessionId: string | null;
  command: string;
  workdir: string | null;
  patternMatched: string | null;
  decision: string;
  exitCode: number | null;
  durationMs: number | null;
}

export interface CommandWithDecision {
  command: string;
  decision: Decision;
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
const DB_PATH = join(AUDIT_DIR, "commands.db");

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
        CREATE TABLE IF NOT EXISTS command_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          session_id TEXT,
          message_id TEXT,
          command TEXT NOT NULL,
          workdir TEXT,
          pattern_matched TEXT,
          decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
          exit_code INTEGER,
          duration_ms INTEGER
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON command_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_decision ON command_log(decision)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_command ON command_log(command)`);
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

export const logCommand = (entry: LogEntry): number => {
  const db = dbManager.get();
  const result = db.run(
    `INSERT INTO command_log
     (session_id, message_id, command, workdir, pattern_matched, decision, exit_code, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId ?? null,
      entry.messageId ?? null,
      entry.command,
      entry.workdir ?? null,
      entry.patternMatched,
      entry.decision,
      entry.exitCode ?? null,
      entry.durationMs ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
};

export const updateLogEntry = (id: number, exitCode: number, durationMs: number): void => {
  const db = dbManager.get();
  db.run(`UPDATE command_log SET exit_code = ?, duration_ms = ? WHERE id = ?`, [
    exitCode,
    durationMs,
    id,
  ]);
};

// =============================================================================
// Statistics Queries
// =============================================================================

/**
 * Get overall command statistics (totals, allowed/denied counts, avg duration).
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
      FROM command_log
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
      FROM command_log
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
 * Get top denied commands with their counts.
 */
export const getTopDeniedCommands = (since?: Date, limit = 10): CommandCount[] => {
  const db = dbManager.get();
  const params: (string | number)[] = [];

  let query = `
    SELECT command, COUNT(*) as count
    FROM command_log
    WHERE decision = 'deny'
  `;

  if (since) {
    query += ` AND timestamp >= ?`;
    params.push(since.toISOString());
  }

  query += `
    GROUP BY command
    ORDER BY count DESC
    LIMIT ?
  `;
  params.push(limit);

  return db.query(query).all(...params) as CommandCount[];
};

// =============================================================================
// Log Export Queries
// =============================================================================

/**
 * Get command log entries for export.
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
      `SELECT timestamp, session_id, command, workdir, pattern_matched, decision, exit_code, duration_ms
      FROM command_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?`
    )
    .all(...params, limit) as Array<{
    timestamp: string;
    session_id: string | null;
    command: string;
    workdir: string | null;
    pattern_matched: string | null;
    decision: string;
    exit_code: number | null;
    duration_ms: number | null;
  }>;

  return rows.map((row) => ({
    timestamp: row.timestamp,
    sessionId: row.session_id,
    command: row.command,
    workdir: row.workdir,
    patternMatched: row.pattern_matched,
    decision: row.decision,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
  }));
};

// =============================================================================
// Hierarchy Queries
// =============================================================================

/**
 * Get all commands with their decisions for building hierarchy trees.
 */
export const getCommandsWithDecisions = (since?: Date): CommandWithDecision[] => {
  const db = dbManager.get();
  const params: string[] = [];

  let whereClause = "";
  if (since) {
    whereClause = "WHERE timestamp >= ?";
    params.push(since.toISOString());
  }

  const rows = db
    .query(
      `SELECT command, decision
      FROM command_log
      ${whereClause}`
    )
    .all(...params) as Array<{ command: string; decision: string }>;

  return rows.map((row) => ({
    command: row.command,
    decision: row.decision as Decision,
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
