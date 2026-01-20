/**
 * Custom shell execution tool with permission enforcement and auditing.
 * Replaces the built-in bash tool with:
 * - Allowlist-based command permissions
 * - SQLite audit logging
 * - Stats, export, and hierarchy tools
 */

import { tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// Database Setup
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "commands.db");

const getDb = (() => {
  let db: Database | null = null;
  return () => {
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
})();

// =============================================================================
// Permission Patterns
// =============================================================================

type Decision = "allow" | "deny";

interface PermissionPattern {
  pattern: string;
  decision: Decision;
  reason?: string;
}

interface PermissionsConfig {
  rules: PermissionPattern[];
  default: Decision;
  default_reason: string;
}

// Default fallback configuration if YAML fails to load
const FALLBACK_CONFIG: PermissionsConfig = {
  rules: [],
  default: "deny",
  default_reason: "Permissions file failed to load - all commands denied for safety",
};

/**
 * Load permissions from YAML file.
 * Uses a singleton pattern to load only once.
 */
const getPermissions = (() => {
  let config: PermissionsConfig | null = null;
  
  return (): PermissionsConfig => {
    if (config) return config;
    
    const yamlPath = join(import.meta.dir, "sh-permissions.yaml");
    
    try {
      const yamlContent = readFileSync(yamlPath, "utf-8");
      const parsed = Bun.YAML.parse(yamlContent) as {
        rules?: Array<{ pattern: string; decision: string; reason?: string | null }>;
        default?: string;
        default_reason?: string;
      };
      
      if (!parsed || !Array.isArray(parsed.rules)) {
        console.error("[sh] Invalid permissions YAML structure - missing rules array");
        config = FALLBACK_CONFIG;
        return config;
      }
      
      config = {
        rules: parsed.rules.map((rule) => ({
          pattern: rule.pattern,
          decision: rule.decision as Decision,
          reason: rule.reason ?? undefined,
        })),
        default: (parsed.default as Decision) ?? "deny",
        default_reason: parsed.default_reason ?? "Command not in allowlist",
      };
      
      return config;
    } catch (error) {
      console.error(`[sh] Failed to load permissions from ${yamlPath}:`, error);
      config = FALLBACK_CONFIG;
      return config;
    }
  };
})();

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 */
const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
};

interface MatchResult {
  decision: Decision;
  pattern: string | null;
  reason?: string;
  isDefault?: boolean;
}

/**
 * Find the first matching permission pattern for a command.
 */
const matchCommand = (command: string): MatchResult => {
  const trimmed = command.trim();
  const config = getPermissions();
  
  for (const perm of config.rules) {
    const regex = patternToRegex(perm.pattern);
    if (regex.test(trimmed)) {
      return {
        decision: perm.decision,
        pattern: perm.pattern,
        reason: perm.reason,
      };
    }
  }
  
  // Default: use config default (typically deny) if no pattern matches
  return {
    decision: config.default,
    pattern: null,
    reason: config.default_reason,
    isDefault: true,
  };
};

// =============================================================================
// Audit Logging
// =============================================================================

interface LogEntry {
  sessionId?: string;
  messageId?: string;
  command: string;
  workdir?: string;
  patternMatched: string | null;
  decision: Decision;
  exitCode?: number;
  durationMs?: number;
}

const logCommand = (entry: LogEntry): number => {
  const db = getDb();
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

const updateLogEntry = (id: number, exitCode: number, durationMs: number) => {
  const db = getDb();
  db.run(
    `UPDATE command_log SET exit_code = ?, duration_ms = ? WHERE id = ?`,
    [exitCode, durationMs, id]
  );
};

// =============================================================================
// Main Shell Tool
// =============================================================================

export default tool({
  description: `Execute shell commands with permission enforcement and audit logging.
Commands are checked against an allowlist before execution.
Denied commands will return an error with the reason.`,
  args: {
    command: tool.schema.string().describe("The shell command to execute"),
    workdir: tool.schema.string().optional().describe("Working directory for command execution"),
    timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 120000)"),
  },
  async execute(args, context) {
    const { command, workdir, timeout = 120000 } = args;
    const { sessionID, messageID } = context;
    
    // Check permissions
    const match = matchCommand(command);
    
    if (match.decision === "deny") {
      // Log the denied attempt
      logCommand({
        sessionId: sessionID,
        messageId: messageID,
        command,
        workdir,
        patternMatched: match.pattern,
        decision: "deny",
      });
      
      // Format error message based on whether a pattern matched or it was the default deny
      let errorMessage: string;
      if (match.pattern) {
        errorMessage = `Error: Command denied
Pattern: ${match.pattern}
Reason: ${match.reason ?? "No reason provided"}

Command: ${command}`;
      } else {
        errorMessage = `Error: Command denied
Reason: ${match.reason ?? "Command not in allowlist"}

Command: ${command}`;
      }
      
      return errorMessage;
    }
    
    // Log the allowed attempt (will update with exit code after)
    const logId = logCommand({
      sessionId: sessionID,
      messageId: messageID,
      command,
      workdir,
      patternMatched: match.pattern,
      decision: "allow",
    });
    
    const startTime = performance.now();
    
    try {
      // Execute the command
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: workdir ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      
      // Handle timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });
      
      // Wait for completion or timeout
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      
      const durationMs = Math.round(performance.now() - startTime);
      
      // Read output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      
      // Update log with results
      updateLogEntry(logId, exitCode, durationMs);
      
      // Format output
      let output = "";
      if (stdout.trim()) {
        output += stdout;
      }
      if (stderr.trim()) {
        if (output) output += "\n";
        output += `[stderr]\n${stderr}`;
      }
      
      // Truncate if too long
      const MAX_OUTPUT = 50 * 1024; // 50KB
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n...[truncated, ${output.length} bytes total]`;
      }
      
      if (exitCode !== 0) {
        output = `Command exited with code ${exitCode}\n${output}`;
      }
      
      return output || "(no output)";
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      updateLogEntry(logId, -1, durationMs);
      
      return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// =============================================================================
// Stats Tool
// =============================================================================

export const stats = tool({
  description: `Show statistics about shell command execution.
Displays counts of allowed/denied commands, most common patterns, etc.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
  },
  async execute(args) {
    const db = getDb();
    const { since, decision } = args;
    
    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | null)[] = [];
    
    if (since) {
      const sinceDate = parseSince(since);
      conditions.push("timestamp >= ?");
      params.push(sinceDate.toISOString());
    }
    
    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    // Get overall stats
    const overallQuery = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denied,
        AVG(CASE WHEN decision = 'allow' THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM command_log
      ${whereClause}
    `;
    
    const overall = db.query(overallQuery).get(...params) as {
      total: number;
      allowed: number;
      denied: number;
      avg_duration_ms: number | null;
    };
    
    // Get top patterns
    const patternsQuery = `
      SELECT 
        pattern_matched,
        decision,
        COUNT(*) as count
      FROM command_log
      ${whereClause}
      GROUP BY pattern_matched, decision
      ORDER BY count DESC
      LIMIT 15
    `;
    
    const patterns = db.query(patternsQuery).all(...params) as Array<{
      pattern_matched: string | null;
      decision: string;
      count: number;
    }>;
    
    // Get top commands (denied)
    const deniedQuery = `
      SELECT command, COUNT(*) as count
      FROM command_log
      WHERE decision = 'deny'
      ${since ? "AND timestamp >= ?" : ""}
      GROUP BY command
      ORDER BY count DESC
      LIMIT 10
    `;
    
    const deniedCommands = since
      ? (db.query(deniedQuery).all(parseSince(since).toISOString()) as Array<{
          command: string;
          count: number;
        }>)
      : (db.query(deniedQuery).all() as Array<{ command: string; count: number }>);
    
    // Format output
    let output = "# Shell Command Statistics\n\n";
    
    output += `## Overview\n`;
    output += `- Total commands: ${overall.total}\n`;
    output += `- Allowed: ${overall.allowed} (${((overall.allowed / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    output += `- Denied: ${overall.denied} (${((overall.denied / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    if (overall.avg_duration_ms !== null) {
      output += `- Avg execution time: ${overall.avg_duration_ms.toFixed(0)}ms\n`;
    }
    output += "\n";
    
    if (patterns.length > 0) {
      output += `## Top Patterns\n`;
      output += "| Pattern | Decision | Count |\n";
      output += "|---------|----------|-------|\n";
      for (const p of patterns) {
        output += `| ${p.pattern_matched ?? "(no match)"} | ${p.decision} | ${p.count} |\n`;
      }
      output += "\n";
    }
    
    if (deniedCommands.length > 0) {
      output += `## Top Denied Commands\n`;
      output += "| Command | Count |\n";
      output += "|---------|-------|\n";
      for (const c of deniedCommands) {
        const truncated = c.command.length > 60 ? c.command.substring(0, 57) + "..." : c.command;
        output += `| \`${truncated}\` | ${c.count} |\n`;
      }
    }
    
    return output;
  },
});

// =============================================================================
// Export Tool
// =============================================================================

export { stats as export_data };

export const export_logs = tool({
  description: `Export command audit logs as CSV or JSON.`,
  args: {
    format: tool.schema
      .enum(["csv", "json"])
      .optional()
      .default("csv")
      .describe("Output format"),
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
    limit: tool.schema
      .number()
      .optional()
      .default(1000)
      .describe("Maximum number of records"),
  },
  async execute(args) {
    const db = getDb();
    const { format = "csv", since, decision, limit = 1000 } = args;
    
    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    
    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }
    
    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    const query = `
      SELECT timestamp, session_id, command, workdir, pattern_matched, decision, exit_code, duration_ms
      FROM command_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    
    params.push(limit);
    
    const rows = db.query(query).all(...params) as Array<{
      timestamp: string;
      session_id: string | null;
      command: string;
      workdir: string | null;
      pattern_matched: string | null;
      decision: string;
      exit_code: number | null;
      duration_ms: number | null;
    }>;
    
    if (format === "json") {
      return JSON.stringify(rows, null, 2);
    }
    
    // CSV format
    const headers = [
      "timestamp",
      "session_id",
      "command",
      "workdir",
      "pattern_matched",
      "decision",
      "exit_code",
      "duration_ms",
    ];
    
    let csv = headers.join(",") + "\n";
    
    for (const row of rows) {
      const values = [
        row.timestamp,
        row.session_id ?? "",
        `"${row.command.replace(/"/g, '""')}"`,
        row.workdir ?? "",
        row.pattern_matched ?? "",
        row.decision,
        row.exit_code?.toString() ?? "",
        row.duration_ms?.toString() ?? "",
      ];
      csv += values.join(",") + "\n";
    }
    
    return csv;
  },
});

// =============================================================================
// Hierarchy Tool
// =============================================================================

export const hierarchy = tool({
  description: `Show command hierarchy tree with usage statistics.
Groups commands by their first words to show patterns of usage.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    minCount: tool.schema
      .number()
      .optional()
      .default(1)
      .describe("Minimum count to display"),
  },
  async execute(args) {
    const db = getDb();
    const { since, minCount = 1 } = args;
    
    // Build query
    const conditions: string[] = [];
    const params: string[] = [];
    
    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    const query = `
      SELECT command, decision
      FROM command_log
      ${whereClause}
    `;
    
    const rows = db.query(query).all(...params) as Array<{
      command: string;
      decision: string;
    }>;
    
    // Build hierarchy tree
    interface TreeNode {
      name: string;
      total: number;
      allowed: number;
      denied: number;
      children: Map<string, TreeNode>;
    }
    
    const root: TreeNode = {
      name: "root",
      total: 0,
      allowed: 0,
      denied: 0,
      children: new Map(),
    };
    
    for (const row of rows) {
      const parts = row.command.trim().split(/\s+/).slice(0, 3); // First 3 words
      let node = root;
      
      root.total++;
      if (row.decision === "allow") root.allowed++;
      else root.denied++;
      
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, {
            name: part,
            total: 0,
            allowed: 0,
            denied: 0,
            children: new Map(),
          });
        }
        node = node.children.get(part)!;
        node.total++;
        if (row.decision === "allow") node.allowed++;
        else node.denied++;
      }
    }
    
    // Render tree
    const renderNode = (node: TreeNode, prefix: string, isLast: boolean): string => {
      if (node.total < minCount) return "";
      
      const denyRate =
        node.total > 0 ? ((node.denied / node.total) * 100).toFixed(1) : "0.0";
      
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";
      
      let line = "";
      if (node.name !== "root") {
        line = `${prefix}${connector}${node.name} (${node.total} total, ${denyRate}% denied)\n`;
      }
      
      const children = Array.from(node.children.values())
        .filter((c) => c.total >= minCount)
        .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);
      
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childIsLast = i === children.length - 1;
        line += renderNode(child, prefix + childPrefix, childIsLast);
      }
      
      return line;
    };
    
    let output = "# Command Hierarchy\n\n";
    output += `Total commands: ${root.total}\n`;
    output += `Allowed: ${root.allowed} | Denied: ${root.denied}\n\n`;
    output += "```\n";
    
    const children = Array.from(root.children.values())
      .filter((c) => c.total >= minCount)
      .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);
    
    for (let i = 0; i < children.length; i++) {
      output += renderNode(children[i], "", i === children.length - 1);
    }
    
    output += "```\n";
    
    return output;
  },
});

// =============================================================================
// Helpers
// =============================================================================

const parseSince = (since: string): Date => {
  const now = new Date();
  
  const match = since.match(/^(\d+)(h|d|w|m)$/);
  if (match) {
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    switch (unit) {
      case "h":
        return new Date(now.getTime() - n * 60 * 60 * 1000);
      case "d":
        return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      case "w":
        return new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000);
      case "m":
        return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000);
    }
  }
  
  // Named periods
  switch (since.toLowerCase()) {
    case "hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "day":
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      // Try parsing as ISO date
      const parsed = new Date(since);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      // Default to 24h
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
};
