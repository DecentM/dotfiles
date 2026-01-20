/**
 * Auxiliary tool definitions for the sh tool (stats, export_logs, hierarchy).
 */

import { tool } from "@opencode-ai/plugin";

import { parseSince } from "./utils";
import { dbManager } from "./db";

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
    const db = dbManager.get();
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
    const db = dbManager.get();
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
