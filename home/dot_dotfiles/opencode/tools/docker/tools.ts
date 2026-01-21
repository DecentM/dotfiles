/**
 * Auxiliary tool definitions for the docker tool (docker_stats, docker_export_logs).
 */

import { tool } from "@opencode-ai/plugin";

import {
  getLogs,
  getOverallStats,
  getPatternStats,
  getTopDeniedOperations,
} from "./db";
import type { Decision } from "./types";
import { parseSince } from "./utils";

// =============================================================================
// Stats Tool
// =============================================================================

export const docker_stats = tool({
  description: `Show statistics about Docker operations.
Displays counts of allowed/denied operations, most common patterns, etc.`,
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
    const deniedOperations = getTopDeniedOperations(filter.since);

    // Format output
    let output = "# Docker Operation Statistics\n\n";

    output += `## Overview\n`;
    output += `- Total operations: ${overall.total}\n`;
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

    if (deniedOperations.length > 0) {
      output += `## Top Denied Operations\n`;
      output += "| Operation | Count |\n";
      output += "|-----------|-------|\n";
      for (const c of deniedOperations) {
        output += `| \`${c.operation}\` | ${c.count} |\n`;
      }
    }

    return output;
  },
});

// =============================================================================
// Export Logs Tool
// =============================================================================

export const docker_export_logs = tool({
  description: `Export Docker operation audit logs as CSV or JSON.`,
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
      "operation",
      "target",
      "patternMatched",
      "decision",
      "resultSummary",
      "durationMs",
    ];

    let csv = headers.join(",") + "\n";

    for (const row of rows) {
      const values = [
        row.timestamp,
        row.sessionId ?? "",
        row.operation,
        row.target ?? "",
        row.patternMatched ?? "",
        row.decision,
        row.resultSummary ? `"${row.resultSummary.replace(/"/g, '""')}"` : "",
        row.durationMs?.toString() ?? "",
      ];
      csv += values.join(",") + "\n";
    }

    return csv;
  },
});
