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
    const params: unknown[] = [];

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
   * Get database path helper
   */
  static getDefaultPath(directory: string): string {
    return `${directory}/.opencode/audit/permissions.db`;
  }

  /**
   * Ensure audit directory exists
   */
  static async ensureDirectory(dbPath: string): Promise<void> {
    await mkdir(dirname(dbPath), { recursive: true });
  }
}
