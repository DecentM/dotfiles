/**
 * OpenCode Permission Audit Plugin - Database Module
 *
 * SQLite database for storing permission audit entries with efficient querying.
 */

import Database from "better-sqlite3";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type {
  AuditEntry,
  AuditEntryRow,
  HierarchyRow,
  SessionMetadata,
} from "./types";

/**
 * Database wrapper for permission audit storage
 */
export class AuditDatabase {
  private db: Database.Database;
  private stmts: {
    insertPermission: Database.Statement;
    updateResponse: Database.Statement;
    getPermission: Database.Statement;
    getPermissions: Database.Statement;
    getPermissionsByType: Database.Statement;
    getPermissionsBySession: Database.Statement;
    getPermissionsByDateRange: Database.Statement;
    insertHierarchy: Database.Statement;
    clearHierarchy: Database.Statement;
    getHierarchy: Database.Statement;
    upsertSession: Database.Statement;
    getSessionStats: Database.Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    // Initialize schema
    this.initSchema();

    // Prepare statements for performance
    this.stmts = this.prepareStatements();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.exec(`
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
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_permissions_type ON permissions(type);
      CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id);
      CREATE INDEX IF NOT EXISTS idx_permissions_created ON permissions(created_at);
      CREATE INDEX IF NOT EXISTS idx_permissions_status ON permissions(initial_status, user_response);

      -- Command hierarchy cache table
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
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON command_hierarchy(parent);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_denial_rate ON command_hierarchy(denial_rate DESC);

      -- Session metadata for correlation
      CREATE TABLE IF NOT EXISTS session_metadata (
        session_id TEXT PRIMARY KEY,
        agent TEXT,
        started_at INTEGER,
        last_activity INTEGER,
        total_permissions INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_session_started ON session_metadata(started_at);
    `);
  }

  /**
   * Prepare SQL statements for reuse
   */
  private prepareStatements() {
    return {
      insertPermission: this.db.prepare(`
        INSERT INTO permissions (
          id, session_id, message_id, call_id, type, pattern, title,
          metadata, initial_status, user_response, created_at, responded_at
        ) VALUES (
          @id, @session_id, @message_id, @call_id, @type, @pattern, @title,
          @metadata, @initial_status, @user_response, @created_at, @responded_at
        )
      `),

      updateResponse: this.db.prepare(`
        UPDATE permissions
        SET user_response = @user_response, responded_at = @responded_at
        WHERE id = @id
      `),

      getPermission: this.db.prepare(`
        SELECT * FROM permissions WHERE id = ?
      `),

      getPermissions: this.db.prepare(`
        SELECT * FROM permissions
        ORDER BY created_at DESC
        LIMIT ?
      `),

      getPermissionsByType: this.db.prepare(`
        SELECT * FROM permissions
        WHERE type = ?
        ORDER BY created_at DESC
        LIMIT ?
      `),

      getPermissionsBySession: this.db.prepare(`
        SELECT * FROM permissions
        WHERE session_id = ?
        ORDER BY created_at DESC
      `),

      getPermissionsByDateRange: this.db.prepare(`
        SELECT * FROM permissions
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `),

      insertHierarchy: this.db.prepare(`
        INSERT OR REPLACE INTO command_hierarchy (
          command, parent, level, total_count, denied_count,
          asked_count, allowed_count, denial_rate, last_seen
        ) VALUES (
          @command, @parent, @level, @total_count, @denied_count,
          @asked_count, @allowed_count, @denial_rate, @last_seen
        )
      `),

      clearHierarchy: this.db.prepare(`DELETE FROM command_hierarchy`),

      getHierarchy: this.db.prepare(`
        SELECT * FROM command_hierarchy
        ORDER BY denial_rate DESC, total_count DESC
      `),

      upsertSession: this.db.prepare(`
        INSERT INTO session_metadata (session_id, started_at, last_activity, total_permissions)
        VALUES (@session_id, @started_at, @last_activity, 1)
        ON CONFLICT(session_id) DO UPDATE SET
          last_activity = @last_activity,
          total_permissions = total_permissions + 1
      `),

      getSessionStats: this.db.prepare(`
        SELECT
          session_id,
          total_permissions as total,
          started_at,
          last_activity
        FROM session_metadata
        ORDER BY last_activity DESC
        LIMIT ?
      `),
    };
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

    this.stmts.insertPermission.run({
      id: entry.id,
      session_id: entry.sessionId,
      message_id: entry.messageId,
      call_id: entry.callId ?? null,
      type: entry.type,
      pattern,
      title: entry.title,
      metadata: JSON.stringify(entry.metadata),
      initial_status: entry.initialStatus,
      user_response: entry.userResponse ?? null,
      created_at: entry.createdAt,
      responded_at: entry.respondedAt ?? null,
    });

    // Update session metadata
    this.stmts.upsertSession.run({
      session_id: entry.sessionId,
      started_at: entry.createdAt,
      last_activity: entry.createdAt,
    });
  }

  /**
   * Update permission with user response
   */
  updatePermissionResponse(
    id: string,
    response: "once" | "always" | "reject",
    respondedAt: number
  ): void {
    this.stmts.updateResponse.run({
      id,
      user_response: response,
      responded_at: respondedAt,
    });
  }

  /**
   * Get a single permission by ID
   */
  getPermission(id: string): AuditEntry | null {
    const row = this.stmts.getPermission.get(id) as AuditEntryRow | undefined;
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
      rows = this.stmts.getPermissionsByDateRange.all(
        options.startDate,
        options.endDate
      ) as AuditEntryRow[];
    } else if (options.type) {
      rows = this.stmts.getPermissionsByType.all(
        options.type,
        limit
      ) as AuditEntryRow[];
    } else if (options.sessionId) {
      rows = this.stmts.getPermissionsBySession.all(
        options.sessionId
      ) as AuditEntryRow[];
    } else {
      rows = this.stmts.getPermissions.all(limit) as AuditEntryRow[];
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
    const transaction = this.db.transaction((hierarchyRows: HierarchyRow[]) => {
      this.stmts.clearHierarchy.run();
      for (const row of hierarchyRows) {
        this.stmts.insertHierarchy.run({
          command: row.command,
          parent: row.parent,
          level: row.level,
          total_count: row.total_count,
          denied_count: row.denied_count,
          asked_count: row.asked_count,
          allowed_count: row.allowed_count,
          denial_rate: row.denial_rate,
          last_seen: row.last_seen,
        });
      }
    });

    transaction(rows);
  }

  /**
   * Get cached hierarchy
   */
  getHierarchyCache(): HierarchyRow[] {
    return this.stmts.getHierarchy.all() as HierarchyRow[];
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
    const rows = this.stmts.getSessionStats.all(limit) as Array<{
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
