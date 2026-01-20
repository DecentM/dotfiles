/**
 * OpenCode Permission Audit Plugin
 *
 * Audits all permission requests and their outcomes, storing them in SQLite.
 * Provides tools to view hierarchical command trees sorted by denial frequency.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import type { Permission, Event } from "@opencode-ai/sdk";

import { AuditDatabase } from "./database";
import { getHierarchy, formatHierarchy, rebuildHierarchy } from "./hierarchy";
import { calculateStats, formatStats, formatStatsJson } from "./stats";
import {
  generateExport,
  exportToFile,
  exportHierarchyCsv,
  exportHierarchyJson,
} from "./export";
import type { AuditEntry, ExportFilters } from "./types";

/**
 * In-memory cache for correlating permission asks with responses
 * Also tracks which permissions we've already logged to avoid duplicates
 */
const pendingPermissions = new Map<string, AuditEntry>();
const loggedPermissions = new Set<string>();

/**
 * Counter for batching hierarchy rebuilds
 */
let permissionsSinceRebuild = 0;
const REBUILD_THRESHOLD = 10;

/**
 * OpenCode Audit Plugin
 */
export const AuditPlugin: Plugin = async ({
  directory,
  client,
}: PluginInput) => {
  // Initialize database
  const dbPath = AuditDatabase.getDefaultPath(directory);
  await AuditDatabase.ensureDirectory(dbPath);
  const db = new AuditDatabase(dbPath);

  console.log(`[audit-plugin] Initialized with database at ${dbPath}`);

  /**
   * Helper to insert a permission entry
   */
  const insertPermissionEntry = (entry: AuditEntry): boolean => {
    if (loggedPermissions.has(entry.id)) {
      return false; // Already logged
    }

    try {
      db.insertPermission(entry);
      loggedPermissions.add(entry.id);
      permissionsSinceRebuild++;
      console.log(
        `[audit-plugin] Logged: type=${entry.type}, pattern=${entry.pattern}, status=${entry.initialStatus}`
      );
      return true;
    } catch (error) {
      console.error("[audit-plugin] Failed to insert permission:", error);
      return false;
    }
  };

  return {
    /**
     * Intercept permission requests - this hook fires for ALL permission checks
     * with the resolved status (allow/deny/ask)
     */
    "permission.ask": async (
      input: Permission,
      output: { status: "ask" | "deny" | "allow" }
    ) => {
      console.log(
        `[audit-plugin] permission.ask: type=${input.type}, pattern=${input.pattern}, status=${output.status}`
      );

      const entry: AuditEntry = {
        id: input.id,
        sessionId: input.sessionID,
        messageId: input.messageID,
        callId: input.callID,
        type: input.type,
        pattern: input.pattern,
        title: input.title,
        metadata: input.metadata as Record<string, unknown>,
        initialStatus: output.status,
        createdAt: input.time.created,
      };

      // Store in memory for later correlation with response (for "ask" status)
      if (output.status === "ask") {
        pendingPermissions.set(input.id, entry);
      }

      // Log to database
      insertPermissionEntry(entry);
    },

    /**
     * Subscribe to events to catch:
     * 1. permission.updated - fires for all permission checks (fallback if hook doesn't fire)
     * 2. permission.replied - captures user responses to "ask" prompts
     */
    event: async ({ event }: { event: Event }) => {
      // Handle permission.updated events as fallback
      // This should fire for ALL permission checks
      if (event.type === "permission.updated") {
        const permission = event.properties;
        console.log(
          `[audit-plugin] permission.updated: type=${permission.type}, pattern=${permission.pattern}`
        );

        // Only log if not already logged via permission.ask hook
        if (!loggedPermissions.has(permission.id)) {
          const entry: AuditEntry = {
            id: permission.id,
            sessionId: permission.sessionID,
            messageId: permission.messageID,
            callId: permission.callID,
            type: permission.type,
            pattern: permission.pattern,
            title: permission.title,
            metadata: permission.metadata as Record<string, unknown>,
            // permission.updated doesn't include status, so we mark as "ask"
            // and rely on permission.replied to update it
            initialStatus: "ask",
            createdAt: permission.time.created,
          };

          pendingPermissions.set(permission.id, entry);
          insertPermissionEntry(entry);
        }
      }

      // Handle permission.replied events - user responded to a prompt
      if (event.type === "permission.replied") {
        const { sessionID, permissionID, response } = event.properties;
        console.log(
          `[audit-plugin] permission.replied: id=${permissionID}, response=${response}`
        );

        const pendingEntry = pendingPermissions.get(permissionID);

        if (pendingEntry) {
          // Update database with user response
          try {
            db.updatePermissionResponse(
              permissionID,
              response as "once" | "always" | "reject",
              Date.now()
            );
            console.log(
              `[audit-plugin] Updated response for ${permissionID}: ${response}`
            );
          } catch (error) {
            console.error(
              "[audit-plugin] Failed to update permission response:",
              error
            );
          }

          pendingPermissions.delete(permissionID);
        }

        // Rebuild hierarchy periodically
        if (permissionsSinceRebuild >= REBUILD_THRESHOLD) {
          try {
            rebuildHierarchy(db);
            permissionsSinceRebuild = 0;
          } catch (error) {
            console.error(
              "[audit-plugin] Failed to rebuild hierarchy:",
              error
            );
          }
        }
      }
    },

    /**
     * Custom tools for agents to query audit data
     */
    tool: {
      /**
       * View hierarchical permission audit tree
       */
      viewAuditHierarchy: tool({
        description:
          "View hierarchical permission audit tree sorted by denial rate. Shows bash commands organized as parent/child relationships (e.g., npm -> npm run -> npm run build) with denial statistics at each level.",
        args: {
          type: tool.schema
            .string()
            .optional()
            .describe("Filter by permission type (e.g., 'bash', 'edit')"),
          minDenialRate: tool.schema
            .number()
            .optional()
            .describe(
              "Minimum denial rate to show (0-1, e.g., 0.5 for 50%+ denied)"
            ),
          maxDepth: tool.schema
            .number()
            .optional()
            .describe("Maximum tree depth to display"),
          forceRebuild: tool.schema
            .boolean()
            .optional()
            .describe("Force rebuild of hierarchy from database"),
        },
        async execute(args) {
          try {
            const hierarchy = getHierarchy(db, args.forceRebuild ?? false);

            if (hierarchy.length === 0) {
              return "No permission audit data found. Permissions will be logged as they are requested.";
            }

            const formatted = formatHierarchy(hierarchy, {
              maxDepth: args.maxDepth,
              minDenialRate: args.minDenialRate,
              showCounts: true,
            });

            return formatted;
          } catch (error) {
            return `Error retrieving hierarchy: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),

      /**
       * Show permission audit statistics
       */
      auditStats: tool({
        description:
          "Show permission audit statistics including approval rates, top denied commands, and session correlation data.",
        args: {
          startDate: tool.schema
            .string()
            .optional()
            .describe("Start date filter (ISO format or 'today', 'week', 'month')"),
          endDate: tool.schema
            .string()
            .optional()
            .describe("End date filter (ISO format)"),
          type: tool.schema
            .string()
            .optional()
            .describe("Filter by permission type"),
          format: tool.schema
            .enum(["text", "json"])
            .optional()
            .describe("Output format (default: text)"),
        },
        async execute(args) {
          try {
            // Parse date filters
            let startDate: number | undefined;
            let endDate: number | undefined;

            if (args.startDate) {
              if (args.startDate === "today") {
                startDate = Date.now() - 24 * 60 * 60 * 1000;
              } else if (args.startDate === "week") {
                startDate = Date.now() - 7 * 24 * 60 * 60 * 1000;
              } else if (args.startDate === "month") {
                startDate = Date.now() - 30 * 24 * 60 * 60 * 1000;
              } else {
                startDate = new Date(args.startDate).getTime();
              }
            }

            if (args.endDate) {
              endDate = new Date(args.endDate).getTime();
            }

            // Ensure hierarchy is built for top commands
            rebuildHierarchy(db);

            const stats = calculateStats(db, {
              startDate,
              endDate,
              type: args.type,
            });

            if (stats.totalPermissions === 0) {
              return "No permission audit data found. Permissions will be logged as they are requested.";
            }

            return args.format === "json"
              ? formatStatsJson(stats)
              : formatStats(stats);
          } catch (error) {
            return `Error calculating statistics: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),

      /**
       * Export audit report
       */
      exportAuditReport: tool({
        description:
          "Export permission audit report in CSV or JSON format. Can filter by date range, type, and status.",
        args: {
          format: tool.schema
            .enum(["csv", "json"])
            .describe("Export format"),
          output: tool.schema
            .string()
            .optional()
            .describe("Output file path (if not specified, returns content)"),
          startDate: tool.schema
            .string()
            .optional()
            .describe("Start date filter (ISO format)"),
          endDate: tool.schema
            .string()
            .optional()
            .describe("End date filter (ISO format)"),
          type: tool.schema
            .string()
            .optional()
            .describe("Filter by permission type"),
          status: tool.schema
            .enum(["ask", "allow", "deny"])
            .optional()
            .describe("Filter by initial status"),
          limit: tool.schema
            .number()
            .optional()
            .describe("Maximum number of entries to export"),
          hierarchyOnly: tool.schema
            .boolean()
            .optional()
            .describe("Export only the command hierarchy (not individual permissions)"),
        },
        async execute(args) {
          try {
            // Handle hierarchy-only export
            if (args.hierarchyOnly) {
              rebuildHierarchy(db);
              const content =
                args.format === "csv"
                  ? exportHierarchyCsv(db)
                  : exportHierarchyJson(db);

              if (args.output) {
                await exportToFile(db, { format: args.format }, args.output);
                return `Hierarchy exported to ${args.output}`;
              }
              return content;
            }

            // Build filters
            const filters: ExportFilters = {
              format: args.format,
              type: args.type,
              status: args.status,
              limit: args.limit,
              startDate: args.startDate
                ? new Date(args.startDate).getTime()
                : undefined,
              endDate: args.endDate
                ? new Date(args.endDate).getTime()
                : undefined,
            };

            if (args.output) {
              await exportToFile(db, filters, args.output);
              return `Report exported to ${args.output}`;
            }

            const content = generateExport(db, filters);

            // Truncate if too long for tool response
            if (content.length > 50000) {
              return (
                content.substring(0, 50000) +
                "\n\n[Output truncated. Use 'output' parameter to save full report to file.]"
              );
            }

            return content;
          } catch (error) {
            return `Error exporting report: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),

      /**
       * Rebuild the command hierarchy cache
       */
      rebuildAuditHierarchy: tool({
        description:
          "Force rebuild of the command hierarchy cache from the audit database. Useful after bulk operations or if hierarchy seems stale.",
        args: {},
        async execute() {
          try {
            const hierarchy = rebuildHierarchy(db);
            permissionsSinceRebuild = 0;
            return `Hierarchy rebuilt successfully. ${hierarchy.length} root commands indexed.`;
          } catch (error) {
            return `Error rebuilding hierarchy: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),
    },
  };
};

// Default export for OpenCode plugin loading
export default AuditPlugin;
