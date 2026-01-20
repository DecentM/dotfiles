/**
 * OpenCode Permission Audit Plugin - Export Module
 *
 * Exports audit data in CSV and JSON formats with filtering support.
 */

import { writeFile } from "fs/promises";
import type { AuditDatabase } from "./database";
import type { AuditEntry, ExportFilters } from "./types";

/**
 * Export audit entries to CSV format
 */
export const exportCsv = (
  db: AuditDatabase,
  filters?: Omit<ExportFilters, "format">
): string => {
  const entries = db.getPermissions({
    type: filters?.type,
    sessionId: filters?.sessionId,
    startDate: filters?.startDate,
    endDate: filters?.endDate,
    limit: filters?.limit ?? 10000,
  });

  // Filter by status if specified
  const filteredEntries = filters?.status
    ? entries.filter((e) => e.initialStatus === filters.status)
    : entries;

  // CSV headers
  const headers = [
    "id",
    "session_id",
    "message_id",
    "call_id",
    "type",
    "pattern",
    "title",
    "initial_status",
    "user_response",
    "created_at",
    "responded_at",
  ];

  const lines: string[] = [headers.join(",")];

  for (const entry of filteredEntries) {
    const pattern =
      typeof entry.pattern === "string"
        ? entry.pattern
        : JSON.stringify(entry.pattern ?? "");

    const row = [
      escapeCsv(entry.id),
      escapeCsv(entry.sessionId),
      escapeCsv(entry.messageId),
      escapeCsv(entry.callId ?? ""),
      escapeCsv(entry.type),
      escapeCsv(pattern),
      escapeCsv(entry.title),
      escapeCsv(entry.initialStatus),
      escapeCsv(entry.userResponse ?? ""),
      new Date(entry.createdAt).toISOString(),
      entry.respondedAt ? new Date(entry.respondedAt).toISOString() : "",
    ];

    lines.push(row.join(","));
  }

  return lines.join("\n");
};

/**
 * Export audit entries to JSON format
 */
export const exportJson = (
  db: AuditDatabase,
  filters?: Omit<ExportFilters, "format">
): string => {
  const entries = db.getPermissions({
    type: filters?.type,
    sessionId: filters?.sessionId,
    startDate: filters?.startDate,
    endDate: filters?.endDate,
    limit: filters?.limit ?? 10000,
  });

  // Filter by status if specified
  const filteredEntries = filters?.status
    ? entries.filter((e) => e.initialStatus === filters.status)
    : entries;

  const exportData = {
    exportedAt: new Date().toISOString(),
    filters: filters ?? {},
    totalCount: filteredEntries.length,
    entries: filteredEntries.map((entry) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      messageId: entry.messageId,
      callId: entry.callId,
      type: entry.type,
      pattern: entry.pattern,
      title: entry.title,
      initialStatus: entry.initialStatus,
      userResponse: entry.userResponse,
      createdAt: new Date(entry.createdAt).toISOString(),
      respondedAt: entry.respondedAt
        ? new Date(entry.respondedAt).toISOString()
        : null,
      metadata: entry.metadata,
    })),
  };

  return JSON.stringify(exportData, null, 2);
};

/**
 * Export and write to file
 */
export const exportToFile = async (
  db: AuditDatabase,
  filters: ExportFilters,
  outputPath: string
): Promise<void> => {
  const content =
    filters.format === "csv"
      ? exportCsv(db, filters)
      : exportJson(db, filters);

  await writeFile(outputPath, content, "utf-8");
};

/**
 * Generate export based on filters
 */
export const generateExport = (
  db: AuditDatabase,
  filters: ExportFilters
): string => {
  return filters.format === "csv"
    ? exportCsv(db, filters)
    : exportJson(db, filters);
};

/**
 * Escape a value for CSV
 */
const escapeCsv = (value: string): string => {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

/**
 * Export hierarchy as CSV
 */
export const exportHierarchyCsv = (db: AuditDatabase): string => {
  const hierarchy = db.getHierarchyCache();

  const headers = [
    "command",
    "parent",
    "level",
    "total_count",
    "denied_count",
    "asked_count",
    "allowed_count",
    "denial_rate",
    "last_seen",
  ];

  const lines: string[] = [headers.join(",")];

  for (const row of hierarchy) {
    const line = [
      escapeCsv(row.command),
      escapeCsv(row.parent ?? ""),
      row.level.toString(),
      row.total_count.toString(),
      row.denied_count.toString(),
      row.asked_count.toString(),
      row.allowed_count.toString(),
      row.denial_rate.toFixed(4),
      row.last_seen ? new Date(row.last_seen).toISOString() : "",
    ];

    lines.push(line.join(","));
  }

  return lines.join("\n");
};

/**
 * Export hierarchy as JSON
 */
export const exportHierarchyJson = (db: AuditDatabase): string => {
  const hierarchy = db.getHierarchyCache();

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalCommands: hierarchy.length,
      hierarchy: hierarchy.map((row) => ({
        command: row.command,
        parent: row.parent,
        level: row.level,
        totalCount: row.total_count,
        deniedCount: row.denied_count,
        askedCount: row.asked_count,
        allowedCount: row.allowed_count,
        denialRate: row.denial_rate,
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      })),
    },
    null,
    2
  );
};
