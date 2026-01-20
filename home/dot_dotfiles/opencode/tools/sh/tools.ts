/**
 * Auxiliary tool definitions for the sh tool (stats, export_logs, hierarchy).
 */

import { tool } from "@opencode-ai/plugin";

import {
  getCommandsWithDecisions,
  getLogs,
  getOverallStats,
  getPatternStats,
  getTopDeniedCommands,
} from "./db";
import type { Decision } from "./types";
import { parseSince } from "./utils";

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
    const { since, decision } = args;

    const filter = {
      since: since ? parseSince(since) : undefined,
      decision: decision as Decision | undefined,
    };

    const overall = getOverallStats(filter);
    const patterns = getPatternStats(filter);
    const deniedCommands = getTopDeniedCommands(filter.since);

    // Format output
    let output = "# Shell Command Statistics\n\n";

    output += `## Overview\n`;
    output += `- Total commands: ${overall.total}\n`;
    output += `- Allowed: ${overall.allowed} (${((overall.allowed / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    output += `- Denied: ${overall.denied} (${((overall.denied / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    if (overall.avgDurationMs !== null) {
      output += `- Avg execution time: ${overall.avgDurationMs.toFixed(0)}ms\n`;
    }
    output += "\n";

    if (patterns.length > 0) {
      output += `## Top Patterns\n`;
      output += "| Pattern | Decision | Count |\n";
      output += "|---------|----------|-------|\n";
      for (const p of patterns) {
        output += `| ${p.patternMatched ?? "(no match)"} | ${p.decision} | ${p.count} |\n`;
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
    const { format = "csv", since, decision, limit = 1000 } = args;

    const rows = getLogs({
      since: since ? parseSince(since) : undefined,
      decision: decision as Decision | undefined,
      limit,
    });

    if (format === "json") {
      return JSON.stringify(rows, null, 2);
    }

    // CSV format
    const headers = [
      "timestamp",
      "sessionId",
      "command",
      "workdir",
      "patternMatched",
      "decision",
      "exitCode",
      "durationMs",
    ];

    let csv = headers.join(",") + "\n";

    for (const row of rows) {
      const values = [
        row.timestamp,
        row.sessionId ?? "",
        `"${row.command.replace(/"/g, '""')}"`,
        row.workdir ?? "",
        row.patternMatched ?? "",
        row.decision,
        row.exitCode?.toString() ?? "",
        row.durationMs?.toString() ?? "",
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
    const { since, minCount = 1 } = args;

    const rows = getCommandsWithDecisions(since ? parseSince(since) : undefined);

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
