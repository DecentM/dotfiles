/**
 * OpenCode Permission Audit Plugin - Log Parser
 *
 * Parses OpenCode log files to extract permission evaluations.
 * This captures ALL permissions (allow/deny/ask) from the log files,
 * providing a complete picture of permission activity.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";

/**
 * Parsed permission entry from log file
 */
export interface ParsedPermission {
  timestamp: Date;
  permissionType: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
  matchedRule?: {
    permission: string;
    pattern: string;
    action: string;
  };
  rawLine?: string;
}

/**
 * Filters for parsing logs
 */
export interface LogParseFilters {
  since?: Date;
  until?: Date;
  type?: string;
  action?: "allow" | "deny" | "ask";
}

/**
 * Summary statistics from parsed logs
 */
export interface LogParseSummary {
  total: number;
  allowed: number;
  denied: number;
  asked: number;
  allowRate: number;
  denyRate: number;
  askRate: number;
  byType: Record<string, { total: number; allowed: number; denied: number; asked: number }>;
  topDenied: Array<{ pattern: string; count: number }>;
  topAllowed: Array<{ pattern: string; count: number }>;
  timeRange: { start: Date | null; end: Date | null };
}

/**
 * Get the default log directory path
 */
export const getDefaultLogDirectory = (): string => {
  const home = homedir();
  return join(home, ".local", "share", "opencode", "log");
};

/**
 * Get the most recent log file in the directory
 */
export const getRecentLogFile = async (
  dirPath: string = getDefaultLogDirectory()
): Promise<string | null> => {
  try {
    const files = await readdir(dirPath);
    const logFiles = files
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse();

    if (logFiles.length === 0) {
      return null;
    }

    return join(dirPath, logFiles[0]);
  } catch {
    return null;
  }
};

/**
 * List all log files in the directory, sorted by date (newest first)
 */
export const listLogFiles = async (
  dirPath: string = getDefaultLogDirectory()
): Promise<string[]> => {
  try {
    const files = await readdir(dirPath);
    return files
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse()
      .map((f) => join(dirPath, f));
  } catch {
    return [];
  }
};

/**
 * Parse timestamp from log line prefix
 * Format: INFO  2026-01-20T04:50:47 +1ms
 */
const parseTimestamp = (line: string): Date | null => {
  // Match ISO-like timestamp: YYYY-MM-DDTHH:MM:SS
  const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!match) {
    return null;
  }

  try {
    return new Date(match[1]);
  } catch {
    return null;
  }
};

/**
 * Parse a single log line for permission evaluation
 * 
 * Log format:
 * INFO  2026-01-20T04:50:47 +1ms service=permission permission=bash pattern=git status action={"permission":"bash","pattern":"git*","action":"allow"} evaluated
 */
const parsePermissionLine = (line: string): ParsedPermission | null => {
  // Must be a permission evaluation line
  if (!line.includes("service=permission") || !line.endsWith("evaluated")) {
    return null;
  }

  const timestamp = parseTimestamp(line);
  if (!timestamp) {
    return null;
  }

  // Extract permission type
  const permissionMatch = line.match(/permission=(\S+)\s+pattern=/);
  if (!permissionMatch) {
    return null;
  }
  const permissionType = permissionMatch[1];

  // Extract pattern - everything between "pattern=" and " action="
  const patternMatch = line.match(/pattern=(.+?)\s+action=\{/);
  if (!patternMatch) {
    return null;
  }
  const pattern = patternMatch[1];

  // Extract action JSON
  const actionMatch = line.match(/action=(\{[^}]+\})\s+evaluated$/);
  if (!actionMatch) {
    return null;
  }

  let matchedRule: ParsedPermission["matchedRule"];
  let action: "allow" | "deny" | "ask" = "deny";

  try {
    const actionJson = JSON.parse(actionMatch[1]);
    action = actionJson.action as "allow" | "deny" | "ask";
    matchedRule = {
      permission: actionJson.permission,
      pattern: actionJson.pattern,
      action: actionJson.action,
    };
  } catch {
    // If JSON parsing fails, try to extract action from the string
    if (actionMatch[1].includes('"action":"allow"')) {
      action = "allow";
    } else if (actionMatch[1].includes('"action":"ask"')) {
      action = "ask";
    } else {
      action = "deny";
    }
  }

  return {
    timestamp,
    permissionType,
    pattern,
    action,
    matchedRule,
    rawLine: line,
  };
};

/**
 * Parse a single log file and extract permission entries
 */
export const parseLogFile = async (
  filePath: string,
  filters?: LogParseFilters
): Promise<ParsedPermission[]> => {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const entries: ParsedPermission[] = [];

    for (const line of lines) {
      const entry = parsePermissionLine(line);
      if (!entry) {
        continue;
      }

      // Apply filters
      if (filters?.since && entry.timestamp < filters.since) {
        continue;
      }
      if (filters?.until && entry.timestamp > filters.until) {
        continue;
      }
      if (filters?.type && entry.permissionType !== filters.type) {
        continue;
      }
      if (filters?.action && entry.action !== filters.action) {
        continue;
      }

      entries.push(entry);
    }

    return entries;
  } catch (error) {
    console.error(`Error parsing log file ${filePath}:`, error);
    return [];
  }
};

/**
 * Parse all log files in a directory
 */
export const parseLogDirectory = async (
  dirPath: string = getDefaultLogDirectory(),
  filters?: LogParseFilters
): Promise<ParsedPermission[]> => {
  const logFiles = await listLogFiles(dirPath);
  const allEntries: ParsedPermission[] = [];

  for (const logFile of logFiles) {
    // Optimization: check file modification time against filters
    if (filters?.since) {
      try {
        const fileStat = await stat(logFile);
        // Skip files that were last modified before our start date
        if (fileStat.mtime < filters.since) {
          continue;
        }
      } catch {
        // Ignore stat errors, try to parse anyway
      }
    }

    const entries = await parseLogFile(logFile, filters);
    allEntries.push(...entries);
  }

  // Sort by timestamp descending
  allEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return allEntries;
};

/**
 * Generate summary statistics from parsed permissions
 */
export const generateSummary = (entries: ParsedPermission[]): LogParseSummary => {
  const summary: LogParseSummary = {
    total: entries.length,
    allowed: 0,
    denied: 0,
    asked: 0,
    allowRate: 0,
    denyRate: 0,
    askRate: 0,
    byType: {},
    topDenied: [],
    topAllowed: [],
    timeRange: { start: null, end: null },
  };

  if (entries.length === 0) {
    return summary;
  }

  // Count by action
  const deniedPatterns = new Map<string, number>();
  const allowedPatterns = new Map<string, number>();

  for (const entry of entries) {
    // Update time range
    if (!summary.timeRange.start || entry.timestamp < summary.timeRange.start) {
      summary.timeRange.start = entry.timestamp;
    }
    if (!summary.timeRange.end || entry.timestamp > summary.timeRange.end) {
      summary.timeRange.end = entry.timestamp;
    }

    // Count by action
    switch (entry.action) {
      case "allow":
        summary.allowed++;
        allowedPatterns.set(
          entry.pattern,
          (allowedPatterns.get(entry.pattern) ?? 0) + 1
        );
        break;
      case "deny":
        summary.denied++;
        deniedPatterns.set(
          entry.pattern,
          (deniedPatterns.get(entry.pattern) ?? 0) + 1
        );
        break;
      case "ask":
        summary.asked++;
        break;
    }

    // Count by type
    if (!summary.byType[entry.permissionType]) {
      summary.byType[entry.permissionType] = {
        total: 0,
        allowed: 0,
        denied: 0,
        asked: 0,
      };
    }
    summary.byType[entry.permissionType].total++;
    if (entry.action === "allow") {
      summary.byType[entry.permissionType].allowed++;
    } else if (entry.action === "deny") {
      summary.byType[entry.permissionType].denied++;
    } else {
      summary.byType[entry.permissionType].asked++;
    }
  }

  // Calculate rates
  summary.allowRate = summary.allowed / summary.total;
  summary.denyRate = summary.denied / summary.total;
  summary.askRate = summary.asked / summary.total;

  // Sort top denied patterns
  summary.topDenied = Array.from(deniedPatterns.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Sort top allowed patterns
  summary.topAllowed = Array.from(allowedPatterns.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return summary;
};

/**
 * Format summary for CLI output
 */
export const formatSummary = (summary: LogParseSummary): string => {
  const lines: string[] = [];

  // Header with time range
  if (summary.timeRange.start && summary.timeRange.end) {
    const start = summary.timeRange.start.toISOString().slice(0, 19).replace("T", " ");
    const end = summary.timeRange.end.toISOString().slice(0, 19).replace("T", " ");
    lines.push(`Permission Summary (${start} to ${end})`);
  } else {
    lines.push("Permission Summary");
  }
  lines.push("=".repeat(50));

  // Totals
  lines.push(`Total: ${summary.total}`);
  lines.push(
    `  Allow: ${summary.allowed} (${(summary.allowRate * 100).toFixed(1)}%)`
  );
  lines.push(
    `  Deny: ${summary.denied} (${(summary.denyRate * 100).toFixed(1)}%)`
  );
  lines.push(
    `  Ask: ${summary.asked} (${(summary.askRate * 100).toFixed(1)}%)`
  );
  lines.push("");

  // By type
  if (Object.keys(summary.byType).length > 0) {
    lines.push("By Permission Type:");
    const typeEntries = Object.entries(summary.byType).sort(
      (a, b) => b[1].total - a[1].total
    );
    for (const [type, stats] of typeEntries) {
      const denyRate = stats.total > 0 ? (stats.denied / stats.total * 100).toFixed(1) : "0.0";
      lines.push(
        `  ${type}: ${stats.total} (${stats.allowed} allow, ${stats.denied} deny, ${stats.asked} ask) [${denyRate}% deny rate]`
      );
    }
    lines.push("");
  }

  // Top denied
  if (summary.topDenied.length > 0) {
    lines.push("Top Denied Commands:");
    for (const { pattern, count } of summary.topDenied) {
      const displayPattern = pattern.length > 50 ? pattern.slice(0, 47) + "..." : pattern;
      lines.push(`  ${displayPattern}: ${count}`);
    }
    lines.push("");
  }

  // Top allowed
  if (summary.topAllowed.length > 0) {
    lines.push("Top Allowed Commands:");
    for (const { pattern, count } of summary.topAllowed.slice(0, 10)) {
      const displayPattern = pattern.length > 50 ? pattern.slice(0, 47) + "..." : pattern;
      lines.push(`  ${displayPattern}: ${count}`);
    }
  }

  return lines.join("\n");
};

/**
 * Format summary as JSON
 */
export const formatSummaryJson = (summary: LogParseSummary): string => {
  return JSON.stringify(
    {
      ...summary,
      timeRange: {
        start: summary.timeRange.start?.toISOString() ?? null,
        end: summary.timeRange.end?.toISOString() ?? null,
      },
    },
    null,
    2
  );
};
