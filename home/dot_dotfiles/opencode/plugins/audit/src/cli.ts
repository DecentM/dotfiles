#!/usr/bin/env bun
/**
 * OpenCode Permission Audit CLI
 *
 * Standalone CLI for querying audit data outside of OpenCode sessions.
 *
 * Usage:
 *   opencode-audit hierarchy [options]    Show command hierarchy
 *   opencode-audit stats [options]        Show statistics
 *   opencode-audit export [options]       Export audit data
 *   opencode-audit parse-logs [options]   Parse log files for permission data
 */

import { parseArgs } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { AuditDatabase } from "./database";
import { getHierarchy, formatHierarchy, rebuildHierarchy } from "./hierarchy";
import { calculateStats, formatStats, formatStatsJson } from "./stats";
import {
  generateExport,
  exportToFile,
  exportHierarchyCsv,
  exportHierarchyJson,
} from "./export";
import {
  parseLogDirectory,
  getDefaultLogDirectory,
  generateSummary,
  formatSummary,
  formatSummaryJson,
  type LogParseFilters,
} from "./log-parser";
import type { ExportFilters } from "./types";

/**
 * Find the audit database - always in ~/.opencode/audit
 */
const findDatabase = (): string | null => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const dbPath = join(home, ".opencode", "audit", "permissions.db");
  
  if (existsSync(dbPath)) {
    return dbPath;
  }

  return null;
};

/**
 * Parse date string into Date object
 * Supports: ISO dates, 'today', 'week', 'month', relative like '24h', '7d'
 */
const parseDate = (dateStr: string): Date => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;

  // Relative formats
  if (dateStr === "today" || dateStr === "24h") {
    return new Date(now - day);
  }
  if (dateStr === "week" || dateStr === "7d") {
    return new Date(now - 7 * day);
  }
  if (dateStr === "month" || dateStr === "30d") {
    return new Date(now - 30 * day);
  }
  
  // Match relative pattern like "12h", "3d"
  const relativeMatch = dateStr.match(/^(\d+)([hd])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    if (unit === "h") {
      return new Date(now - value * hour);
    }
    if (unit === "d") {
      return new Date(now - value * day);
    }
  }

  // ISO date
  return new Date(dateStr);
};

/**
 * Print usage information
 */
const printUsage = (): void => {
  console.log(`
OpenCode Permission Audit CLI

Usage:
  opencode-audit <command> [options]

Commands:
  hierarchy    Show command hierarchy sorted by denial rate
  stats        Show permission statistics (from database)
  export       Export audit data to file
  parse-logs   Parse OpenCode log files for permission evaluations

Global Options:
  --db <path>  Path to audit database (auto-detected if not specified)
  --help       Show this help message

Hierarchy Options:
  --max-depth <n>         Maximum tree depth to show
  --min-denial-rate <n>   Minimum denial rate (0-1) to include
  --rebuild               Force rebuild hierarchy from database

Stats Options:
  --start <date>   Filter from date (ISO or 'today', 'week', 'month')
  --end <date>     Filter to date (ISO)
  --type <type>    Filter by permission type
  --json           Output as JSON

Export Options:
  --format <fmt>   Export format: csv or json (default: csv)
  --output <path>  Output file path (required)
  --start <date>   Filter from date (ISO)
  --end <date>     Filter to date (ISO)
  --type <type>    Filter by permission type
  --status <s>     Filter by status: ask, allow, deny
  --limit <n>      Maximum entries to export
  --hierarchy      Export hierarchy instead of raw data

Parse-Logs Options:
  --since <date>   Filter from date (ISO, 'today', 'week', 'month', '24h', '7d')
  --until <date>   Filter to date (ISO)
  --type <type>    Filter by permission type (e.g., 'bash', 'edit')
  --action <act>   Filter by action: allow, deny, ask
  --log-dir <dir>  Log directory (default: ~/.local/share/opencode/log/)
  --json           Output as JSON

Examples:
  opencode-audit hierarchy
  opencode-audit hierarchy --max-depth 2 --min-denial-rate 0.5
  opencode-audit stats --start week
  opencode-audit stats --type bash --json
  opencode-audit export --format csv --output audit.csv
  opencode-audit export --format json --output hierarchy.json --hierarchy
  opencode-audit parse-logs --since 24h
  opencode-audit parse-logs --since week --action deny
  opencode-audit parse-logs --type bash --json
`);
};

/**
 * Main CLI entry point
 */
const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      // Global
      db: { type: "string" },
      help: { type: "boolean", short: "h" },

      // Hierarchy
      "max-depth": { type: "string" },
      "min-denial-rate": { type: "string" },
      rebuild: { type: "boolean" },

      // Stats
      start: { type: "string" },
      end: { type: "string" },
      type: { type: "string" },
      json: { type: "boolean" },

      // Export
      format: { type: "string" },
      output: { type: "string", short: "o" },
      status: { type: "string" },
      limit: { type: "string" },
      hierarchy: { type: "boolean" },

      // Parse-logs
      since: { type: "string" },
      until: { type: "string" },
      action: { type: "string" },
      "log-dir": { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = positionals[0];

  // Handle parse-logs command separately (doesn't need database)
  if (command === "parse-logs") {
    const logDir = values["log-dir"] ?? getDefaultLogDirectory();

    if (!existsSync(logDir)) {
      console.error(`Error: Log directory not found at ${logDir}`);
      process.exit(1);
    }

    // Build filters
    const filters: LogParseFilters = {};
    
    if (values.since) {
      filters.since = parseDate(values.since);
    }
    if (values.until) {
      filters.until = parseDate(values.until);
    }
    if (values.type) {
      filters.type = values.type;
    }
    if (values.action) {
      if (!["allow", "deny", "ask"].includes(values.action)) {
        console.error("Error: --action must be 'allow', 'deny', or 'ask'");
        process.exit(1);
      }
      filters.action = values.action as "allow" | "deny" | "ask";
    }

    console.error(`Parsing logs from ${logDir}...`);
    const entries = await parseLogDirectory(logDir, filters);

    if (entries.length === 0) {
      console.log("No permission entries found in logs.");
      process.exit(0);
    }

    const summary = generateSummary(entries);
    
    if (values.json) {
      console.log(formatSummaryJson(summary));
    } else {
      console.log(formatSummary(summary));
    }
    process.exit(0);
  }

  // Commands that need the database
  const dbPath = values.db ?? findDatabase();

  if (!dbPath) {
    console.error(
      "Error: Could not find audit database. Use --db to specify path."
    );
    console.error(
      "Make sure you have run OpenCode with the audit plugin enabled."
    );
    process.exit(1);
  }

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new AuditDatabase(dbPath);

  try {
    switch (command) {
      case "hierarchy": {
        if (values.rebuild) {
          console.log("Rebuilding hierarchy...");
          rebuildHierarchy(db);
        }

        const hierarchy = getHierarchy(db, false);

        if (hierarchy.length === 0) {
          console.log("No permission audit data found.");
          break;
        }

        const formatted = formatHierarchy(hierarchy, {
          maxDepth: values["max-depth"]
            ? parseInt(values["max-depth"], 10)
            : undefined,
          minDenialRate: values["min-denial-rate"]
            ? parseFloat(values["min-denial-rate"])
            : undefined,
          showCounts: true,
        });

        console.log(formatted);
        break;
      }

      case "stats": {
        // Parse date filters
        let startDate: number | undefined;
        let endDate: number | undefined;

        if (values.start) {
          startDate = parseDate(values.start).getTime();
        }

        if (values.end) {
          endDate = parseDate(values.end).getTime();
        }

        // Rebuild hierarchy to ensure stats are fresh
        rebuildHierarchy(db);

        const stats = calculateStats(db, {
          startDate,
          endDate,
          type: values.type,
        });

        if (stats.totalPermissions === 0) {
          console.log("No permission audit data found.");
          break;
        }

        console.log(values.json ? formatStatsJson(stats) : formatStats(stats));
        break;
      }

      case "export": {
        const format = (values.format ?? "csv") as "csv" | "json";
        const output = values.output;

        if (!output) {
          console.error("Error: --output is required for export");
          process.exit(1);
        }

        // Handle hierarchy export
        if (values.hierarchy) {
          rebuildHierarchy(db);
          const content =
            format === "csv" ? exportHierarchyCsv(db) : exportHierarchyJson(db);

          const fs = await import("fs/promises");
          await fs.writeFile(output, content, "utf-8");
          console.log(`Hierarchy exported to ${output}`);
          break;
        }

        // Build filters for regular export
        const filters: ExportFilters = {
          format,
          type: values.type,
          status: values.status as "ask" | "allow" | "deny" | undefined,
          limit: values.limit ? parseInt(values.limit, 10) : undefined,
          startDate: values.start
            ? parseDate(values.start).getTime()
            : undefined,
          endDate: values.end ? parseDate(values.end).getTime() : undefined,
        };

        await exportToFile(db, filters, output);
        console.log(`Report exported to ${output}`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    db.close();
  }
};

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
