/**
 * OpenCode Permission Audit Plugin - Statistics Module
 *
 * Calculates and formats permission audit statistics.
 */

import type { AuditDatabase } from "./database";
import type { StatsResult, StatsFilters, getTimeRange } from "./types";

/**
 * Calculate comprehensive statistics from audit data
 */
export const calculateStats = (
  db: AuditDatabase,
  filters?: StatsFilters
): StatsResult => {
  const dbStats = db.getStats({
    startDate: filters?.startDate,
    endDate: filters?.endDate,
    type: filters?.type,
  });

  const total = dbStats.total;
  const { byStatus, byType } = dbStats;

  // Calculate approval rates
  const totalDecided =
    byStatus.auto_allowed +
    byStatus.auto_denied +
    byStatus.user_allowed +
    byStatus.user_denied;
  const totalAllowed = byStatus.auto_allowed + byStatus.user_allowed;
  const autoTotal = byStatus.auto_allowed + byStatus.auto_denied;

  const approvalRate = totalDecided > 0 ? totalAllowed / totalDecided : 0;
  const autoApprovalRate =
    autoTotal > 0 ? byStatus.auto_allowed / autoTotal : 0;

  // Get session stats
  const sessionStats = db.getSessionStats(10);

  // Get top denied commands from hierarchy
  const hierarchy = db.getHierarchyCache();
  const topDenied = hierarchy
    .filter((h) => h.denied_count > 0)
    .sort((a, b) => b.denied_count - a.denied_count)
    .slice(0, 10)
    .map((h) => ({
      command: h.command,
      count: h.denied_count,
      type: "bash",
    }));

  const topAllowed = hierarchy
    .filter((h) => h.allowed_count > 0)
    .sort((a, b) => b.allowed_count - a.allowed_count)
    .slice(0, 10)
    .map((h) => ({
      command: h.command,
      count: h.allowed_count,
      type: "bash",
    }));

  // Format by type stats
  const formattedByType: StatsResult["byType"] = {};
  for (const [type, stats] of Object.entries(byType)) {
    formattedByType[type] = {
      total: stats.total,
      denied: stats.denied,
      allowed: stats.allowed,
      asked: stats.total - stats.denied - stats.allowed, // Approximate
      denialRate: stats.total > 0 ? stats.denied / stats.total : 0,
    };
  }

  return {
    totalPermissions: total,
    autoApproved: byStatus.auto_allowed,
    autoDenied: byStatus.auto_denied,
    userApproved: byStatus.user_allowed,
    userDenied: byStatus.user_denied,
    approvalRate,
    autoApprovalRate,
    byType: formattedByType,
    bySession: sessionStats.map((s) => ({
      sessionId: s.sessionId,
      total: s.total,
      denied: 0, // Would need additional query
      allowed: 0,
      asked: 0,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
    })),
    topDenied,
    topAllowed,
  };
};

/**
 * Format statistics as human-readable text
 */
export const formatStats = (stats: StatsResult): string => {
  const lines: string[] = [];

  lines.push("=== Permission Audit Statistics ===");
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push(`Total Permissions: ${stats.totalPermissions}`);
  lines.push(
    `Approval Rate: ${(stats.approvalRate * 100).toFixed(1)}% (${stats.autoApproved + stats.userApproved} allowed / ${stats.totalPermissions - (stats.autoApproved + stats.userApproved)} denied)`
  );
  lines.push(
    `Auto-Approval Rate: ${(stats.autoApprovalRate * 100).toFixed(1)}%`
  );
  lines.push("");

  // Breakdown
  lines.push("## Decision Breakdown");
  lines.push(`  Auto-Approved: ${stats.autoApproved}`);
  lines.push(`  Auto-Denied: ${stats.autoDenied}`);
  lines.push(`  User-Approved: ${stats.userApproved}`);
  lines.push(`  User-Denied: ${stats.userDenied}`);
  lines.push("");

  // By Type
  if (Object.keys(stats.byType).length > 0) {
    lines.push("## By Permission Type");
    for (const [type, typeStats] of Object.entries(stats.byType)) {
      const denialPct = (typeStats.denialRate * 100).toFixed(1);
      lines.push(
        `  ${type}: ${typeStats.total} total, ${typeStats.denied} denied (${denialPct}%)`
      );
    }
    lines.push("");
  }

  // Top Denied
  if (stats.topDenied.length > 0) {
    lines.push("## Top Denied Commands");
    for (const cmd of stats.topDenied.slice(0, 5)) {
      lines.push(`  ${cmd.count}x ${cmd.command}`);
    }
    lines.push("");
  }

  // Top Allowed
  if (stats.topAllowed.length > 0) {
    lines.push("## Top Allowed Commands");
    for (const cmd of stats.topAllowed.slice(0, 5)) {
      lines.push(`  ${cmd.count}x ${cmd.command}`);
    }
    lines.push("");
  }

  // Recent Sessions
  if (stats.bySession.length > 0) {
    lines.push("## Recent Sessions");
    for (const session of stats.bySession.slice(0, 5)) {
      const date = new Date(session.lastSeen).toISOString().split("T")[0];
      lines.push(
        `  ${session.sessionId.slice(0, 8)}... : ${session.total} permissions (last: ${date})`
      );
    }
  }

  return lines.join("\n");
};

/**
 * Format statistics as JSON
 */
export const formatStatsJson = (stats: StatsResult): string => {
  return JSON.stringify(stats, null, 2);
};

/**
 * Get time-based trend data
 */
export const getTimeTrends = (
  db: AuditDatabase,
  days = 7
): Array<{
  date: string;
  total: number;
  denied: number;
  allowed: number;
}> => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const trends: Array<{
    date: string;
    total: number;
    denied: number;
    allowed: number;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const startOfDay = now - (i + 1) * dayMs;
    const endOfDay = now - i * dayMs;

    const dayStats = db.getStats({
      startDate: startOfDay,
      endDate: endOfDay,
    });

    const date = new Date(endOfDay).toISOString().split("T")[0];

    trends.push({
      date,
      total: dayStats.total,
      denied: dayStats.byStatus.auto_denied + dayStats.byStatus.user_denied,
      allowed: dayStats.byStatus.auto_allowed + dayStats.byStatus.user_allowed,
    });
  }

  return trends;
};
