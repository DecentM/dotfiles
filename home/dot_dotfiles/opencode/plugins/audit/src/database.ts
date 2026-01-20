/**
 * OpenCode Permission Audit Plugin - Database Module
 *
 * SQLite database for storing permission audit entries with efficient querying.
 * Uses Bun's native SQLite support.
 */

import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type {
  AuditEntry,
  AuditEntryRow,
  HierarchyRow,
  ToolExecution,
  ToolExecutionRow,
} from "./types";

/**
 * Database wrapper for permission audit storage
 */
export class AuditDatabase {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });

    // Enable WAL mode for better concurrent access
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");

    // Initialize schema
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.run(`
      -- Main permissions table
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        call_id TEXT,
        type TEXT NOT NULL,
        pattern TEXT,
        title TEXT NOT NULL,
        metadata TEXT,
        initial_status TEXT NOT NULL CHECK (initial_status IN ('ask', 'allow', 'deny')),
        user_response TEXT CHECK (user_response IN ('once', 'always', 'reject', NULL)),
        created_at INTEGER NOT NULL,
        responded_at INTEGER
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_type ON permissions(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_created ON permissions(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_status ON permissions(initial_status, user_response)`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS command_hierarchy (
        command TEXT PRIMARY KEY,
        parent TEXT,
        level INTEGER NOT NULL,
        total_count INTEGER DEFAULT 0,
        denied_count INTEGER DEFAULT 0,
        asked_count INTEGER DEFAULT 0,
        allowed_count INTEGER DEFAULT 0,
        denial_rate REAL DEFAULT 0,
        last_seen INTEGER
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON command_hierarchy(parent)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_hierarchy_denial_rate ON command_hierarchy(denial_rate DESC)`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_metadata (
        session_id TEXT PRIMARY KEY,
        agent TEXT,
        started_at INTEGER,
        last_activity INTEGER,
        total_permissions INTEGER DEFAULT 0
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_session_started ON session_metadata(started_at)`);

    // Tool executions table - tracks what tools actually run
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        title TEXT,
        output_length INTEGER,
        success INTEGER
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tool_executions_tool ON tool_executions(tool_name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tool_executions_started ON tool_executions(started_at)`);
  }

  /**
   * Insert a new permission entry
   */
  insertPermission(entry: AuditEntry): void {
    const pattern = entry.pattern
      ? typeof entry.pattern === "string"
        ? entry.pattern
        : JSON.stringify(entry.pattern)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO permissions (
        id, session_id, message_id, call_id, type, pattern, title,
        metadata, initial_status, user_response, created_at, responded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionId,
      entry.messageId,
      entry.callId ?? null,
      entry.type,
      pattern,
      entry.title,
      JSON.stringify(entry.metadata),
      entry.initialStatus,
      entry.userResponse ?? null,
      entry.createdAt,
      entry.respondedAt ?? null
    );

    // Update session metadata
    const upsertSession = this.db.prepare(`
      INSERT INTO session_metadata (session_id, started_at, last_activity, total_permissions)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(session_id) DO UPDATE SET
        last_activity = excluded.last_activity,
        total_permissions = total_permissions + 1
    `);

    upsertSession.run(entry.sessionId, entry.createdAt, entry.createdAt);
  }

  /**
   * Update permission with user response
   */
  updatePermissionResponse(
    id: string,
    response: "once" | "always" | "reject",
    respondedAt: number
  ): void {
    const stmt = this.db.prepare(`
      UPDATE permissions
      SET user_response = ?, responded_at = ?
      WHERE id = ?
    `);

    stmt.run(response, respondedAt, id);
  }

  /**
   * Get a single permission by ID
   */
  getPermission(id: string): AuditEntry | null {
    const stmt = this.db.prepare(`SELECT * FROM permissions WHERE id = ?`);
    const row = stmt.get(id) as AuditEntryRow | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  /**
   * Get permissions with optional filters
   */
  getPermissions(options: {
    type?: string;
    sessionId?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): AuditEntry[] {
    const limit = options.limit ?? 1000;
    let rows: AuditEntryRow[];

    if (options.startDate !== undefined && options.endDate !== undefined) {
      const stmt = this.db.prepare(`
        SELECT * FROM permissions
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `);
      rows = stmt.all(options.startDate, options.endDate) as AuditEntryRow[];
    } else if (options.type) {
      const stmt = this.db.prepare(`
        SELECT * FROM permissions
        WHERE type = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      rows = stmt.all(options.type, limit) as AuditEntryRow[];
    } else if (options.sessionId) {
      const stmt = this.db.prepare(`
        SELECT * FROM permissions
        WHERE session_id = ?
        ORDER BY created_at DESC
      `);
      rows = stmt.all(options.sessionId) as AuditEntryRow[];
    } else {
      const stmt = this.db.prepare(`
        SELECT * FROM permissions
        ORDER BY created_at DESC
        LIMIT ?
      `);
      rows = stmt.all(limit) as AuditEntryRow[];
    }

    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Get all bash command patterns for hierarchy building
   */
  getBashPatterns(): Array<{
    pattern: string;
    initialStatus: string;
    userResponse: string | null;
    createdAt: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT pattern, initial_status, user_response, created_at
      FROM permissions
      WHERE type = 'bash' AND pattern IS NOT NULL
      ORDER BY created_at DESC
    `);

    const rows = stmt.all() as Array<{
      pattern: string;
      initial_status: string;
      user_response: string | null;
      created_at: number;
    }>;

    // Convert snake_case to camelCase
    return rows.map((row) => ({
      pattern: row.pattern,
      initialStatus: row.initial_status,
      userResponse: row.user_response,
      createdAt: row.created_at,
    }));
  }

  /**
   * Save hierarchy cache to database
   */
  saveHierarchy(rows: HierarchyRow[]): void {
    this.db.run(`DELETE FROM command_hierarchy`);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO command_hierarchy (
        command, parent, level, total_count, denied_count,
        asked_count, allowed_count, denial_rate, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      stmt.run(
        row.command,
        row.parent,
        row.level,
        row.total_count,
        row.denied_count,
        row.asked_count,
        row.allowed_count,
        row.denial_rate,
        row.last_seen
      );
    }
  }

  /**
   * Get cached hierarchy
   */
  getHierarchyCache(): HierarchyRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM command_hierarchy
      ORDER BY denial_rate DESC, total_count DESC
    `);

    return stmt.all() as HierarchyRow[];
  }

  /**
   * Get aggregated statistics
   */
  getStats(filters?: {
    startDate?: number;
    endDate?: number;
    type?: string;
  }): {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, { total: number; denied: number; allowed: number }>;
  } {
    let whereClause = "WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (filters?.startDate !== undefined) {
      whereClause += " AND created_at >= ?";
      params.push(filters.startDate);
    }
    if (filters?.endDate !== undefined) {
      whereClause += " AND created_at <= ?";
      params.push(filters.endDate);
    }
    if (filters?.type) {
      whereClause += " AND type = ?";
      params.push(filters.type);
    }

    // Total count
    const totalStmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM permissions ${whereClause}`
    );
    const total = (totalStmt.get(...params) as { count: number }).count;

    // By status
    const statusStmt = this.db.prepare(`
      SELECT
        initial_status,
        user_response,
        COUNT(*) as count
      FROM permissions
      ${whereClause}
      GROUP BY initial_status, user_response
    `);
    const statusRows = statusStmt.all(...params) as Array<{
      initial_status: string;
      user_response: string | null;
      count: number;
    }>;

    const byStatus: Record<string, number> = {
      auto_allowed: 0,
      auto_denied: 0,
      user_allowed: 0,
      user_denied: 0,
      pending: 0,
    };

    for (const row of statusRows) {
      if (row.initial_status === "allow" && !row.user_response) {
        byStatus.auto_allowed += row.count;
      } else if (row.initial_status === "deny" && !row.user_response) {
        byStatus.auto_denied += row.count;
      } else if (
        row.user_response === "once" ||
        row.user_response === "always"
      ) {
        byStatus.user_allowed += row.count;
      } else if (row.user_response === "reject") {
        byStatus.user_denied += row.count;
      } else if (row.initial_status === "ask" && !row.user_response) {
        byStatus.pending += row.count;
      }
    }

    // By type
    const typeStmt = this.db.prepare(`
      SELECT
        type,
        COUNT(*) as total,
        SUM(CASE WHEN initial_status = 'deny' OR user_response = 'reject' THEN 1 ELSE 0 END) as denied,
        SUM(CASE WHEN initial_status = 'allow' OR user_response IN ('once', 'always') THEN 1 ELSE 0 END) as allowed
      FROM permissions
      ${whereClause}
      GROUP BY type
    `);
    const typeRows = typeStmt.all(...params) as Array<{
      type: string;
      total: number;
      denied: number;
      allowed: number;
    }>;

    const byType: Record<
      string,
      { total: number; denied: number; allowed: number }
    > = {};
    for (const row of typeRows) {
      byType[row.type] = {
        total: row.total,
        denied: row.denied,
        allowed: row.allowed,
      };
    }

    return { total, byStatus, byType };
  }

  /**
   * Get session statistics
   */
  getSessionStats(
    limit = 20
  ): Array<{ sessionId: string; total: number; firstSeen: number; lastSeen: number }> {
    const stmt = this.db.prepare(`
      SELECT
        session_id,
        total_permissions as total,
        started_at,
        last_activity
      FROM session_metadata
      ORDER BY last_activity DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<{
      session_id: string;
      total: number;
      started_at: number;
      last_activity: number;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      total: row.total,
      firstSeen: row.started_at,
      lastSeen: row.last_activity,
    }));
  }

  /**
   * Convert database row to AuditEntry
   */
  private rowToEntry(row: AuditEntryRow): AuditEntry {
    let pattern: string | string[] | undefined;
    if (row.pattern) {
      try {
        pattern = JSON.parse(row.pattern);
      } catch {
        pattern = row.pattern;
      }
    }

    let metadata: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      callId: row.call_id ?? undefined,
      type: row.type,
      pattern,
      title: row.title,
      metadata,
      initialStatus: row.initial_status as "ask" | "allow" | "deny",
      userResponse: row.user_response as
        | "once"
        | "always"
        | "reject"
        | undefined,
      createdAt: row.created_at,
      respondedAt: row.responded_at ?? undefined,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Insert a new tool execution entry (called on tool.execute.before)
   */
  insertToolExecution(execution: ToolExecution): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_executions (
        id, session_id, tool_name, args, started_at, completed_at, title, output_length, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      execution.id,
      execution.sessionId,
      execution.toolName,
      execution.args ? JSON.stringify(execution.args) : null,
      execution.startedAt,
      execution.completedAt ?? null,
      execution.title ?? null,
      execution.outputLength ?? null,
      execution.success !== undefined ? (execution.success ? 1 : 0) : null
    );
  }

  /**
   * Update a tool execution with completion info (called on tool.execute.after)
   */
  updateToolExecution(
    id: string,
    completedAt: number,
    outputLength?: number,
    success?: boolean
  ): void {
    const stmt = this.db.prepare(`
      UPDATE tool_executions
      SET completed_at = ?, output_length = ?, success = ?
      WHERE id = ?
    `);

    stmt.run(
      completedAt,
      outputLength ?? null,
      success !== undefined ? (success ? 1 : 0) : null,
      id
    );
  }

  /**
   * Get a tool execution by ID
   */
  getToolExecution(id: string): ToolExecution | null {
    const stmt = this.db.prepare(`SELECT * FROM tool_executions WHERE id = ?`);
    const row = stmt.get(id) as ToolExecutionRow | undefined;
    return row ? this.toolRowToExecution(row) : null;
  }

  /**
   * Get tool executions with optional filters
   */
  getToolExecutions(options: {
    sessionId?: string;
    toolName?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): ToolExecution[] {
    const limit = options.limit ?? 1000;
    let rows: ToolExecutionRow[];

    if (options.sessionId) {
      const stmt = this.db.prepare(`
        SELECT * FROM tool_executions
        WHERE session_id = ?
        ORDER BY started_at DESC
      `);
      rows = stmt.all(options.sessionId) as ToolExecutionRow[];
    } else if (options.toolName) {
      const stmt = this.db.prepare(`
        SELECT * FROM tool_executions
        WHERE tool_name = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(options.toolName, limit) as ToolExecutionRow[];
    } else if (options.startDate !== undefined && options.endDate !== undefined) {
      const stmt = this.db.prepare(`
        SELECT * FROM tool_executions
        WHERE started_at >= ? AND started_at <= ?
        ORDER BY started_at DESC
      `);
      rows = stmt.all(options.startDate, options.endDate) as ToolExecutionRow[];
    } else {
      const stmt = this.db.prepare(`
        SELECT * FROM tool_executions
        ORDER BY started_at DESC
        LIMIT ?
      `);
      rows = stmt.all(limit) as ToolExecutionRow[];
    }

    return rows.map((row) => this.toolRowToExecution(row));
  }

  /**
   * Get tool execution statistics
   */
  getToolStats(filters?: {
    startDate?: number;
    endDate?: number;
    toolName?: string;
  }): {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
    byTool: Record<string, { total: number; successful: number; avgDuration: number }>;
  } {
    let whereClause = "WHERE 1=1";
    const params: (string | number | null)[] = [];

    if (filters?.startDate !== undefined) {
      whereClause += " AND started_at >= ?";
      params.push(filters.startDate);
    }
    if (filters?.endDate !== undefined) {
      whereClause += " AND started_at <= ?";
      params.push(filters.endDate);
    }
    if (filters?.toolName) {
      whereClause += " AND tool_name = ?";
      params.push(filters.toolName);
    }

    // Total counts
    const totalStmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - started_at END) as avg_duration
      FROM tool_executions
      ${whereClause}
    `);
    const totals = totalStmt.get(...params) as {
      total: number;
      successful: number;
      failed: number;
      avg_duration: number | null;
    };

    // By tool
    const byToolStmt = this.db.prepare(`
      SELECT 
        tool_name,
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - started_at END) as avg_duration
      FROM tool_executions
      ${whereClause}
      GROUP BY tool_name
      ORDER BY total DESC
    `);
    const byToolRows = byToolStmt.all(...params) as Array<{
      tool_name: string;
      total: number;
      successful: number;
      avg_duration: number | null;
    }>;

    const byTool: Record<string, { total: number; successful: number; avgDuration: number }> = {};
    for (const row of byToolRows) {
      byTool[row.tool_name] = {
        total: row.total,
        successful: row.successful,
        avgDuration: row.avg_duration ?? 0,
      };
    }

    return {
      total: totals.total,
      successful: totals.successful,
      failed: totals.failed,
      avgDuration: totals.avg_duration ?? 0,
      byTool,
    };
  }

  /**
   * Convert database row to ToolExecution
   */
  private toolRowToExecution(row: ToolExecutionRow): ToolExecution {
    let args: Record<string, unknown> | undefined;
    if (row.args) {
      try {
        args = JSON.parse(row.args);
      } catch {
        args = undefined;
      }
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      args,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      title: row.title ?? undefined,
      outputLength: row.output_length ?? undefined,
      success: row.success !== null ? row.success === 1 : undefined,
    };
  }

  /**
   * Get database path helper - always uses ~/.opencode/audit for consistent storage
   */
  static getDefaultPath(_directory?: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return `${home}/.opencode/audit/permissions.db`;
  }

  /**
   * Ensure audit directory exists
   */
  static async ensureDirectory(dbPath: string): Promise<void> {
    await mkdir(dirname(dbPath), { recursive: true });
  }
}
