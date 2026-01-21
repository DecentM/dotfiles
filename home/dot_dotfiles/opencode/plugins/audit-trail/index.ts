/**
 * Audit Trail Plugin for OpenCode
 *
 * Logs all tool executions and session events to a SQLite database
 * for comprehensive audit trail and analytics.
 */

import { type Plugin, type Event, tool } from "@opencode-ai/plugin";

import {
	dbManager,
	getLogs,
	getSessionLogs,
	getSessionTimeline,
	getToolStats,
	getToolUsage,
	logSessionEvent,
	logToolExecution,
	updateToolExecution,
} from "./db";
import type { SessionEventType } from "./types";

// =============================================================================
// In-Memory Tracking
// =============================================================================

const PENDING_CALL_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Track in-flight tool calls: callId -> { rowId, startTime, expiry }
 */
const pendingCalls = new Map<
	string,
	{ rowId: number; startTime: number; expiry: number }
>();

/**
 * Start cleanup interval for expired pending calls.
 * Called once when the plugin initializes.
 */
let cleanupIntervalStarted = false;
const startCleanupInterval = (): void => {
	if (cleanupIntervalStarted) {
		return;
	}
	cleanupIntervalStarted = true;

	setInterval(
		() => {
			const now = Date.now();
			for (const [callId, data] of pendingCalls.entries()) {
				if (data.expiry < now) {
					pendingCalls.delete(callId);
				}
			}
		},
		5 * 60 * 1000,
	);
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse an optional ISO date string into a Date object.
 * Returns undefined if the string is empty or invalid.
 */
const parseOptionalDate = (dateStr: string | undefined): Date | undefined => {
	if (!dateStr) {
		return undefined;
	}
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}
	return date;
};

/**
 * Map SDK event types to our session event types.
 */
const mapEventType = (eventType: string): SessionEventType | null => {
	const mapping: Record<string, SessionEventType> = {
		"session.created": "created",
		"session.compacted": "compacted",
		"session.deleted": "deleted",
		"session.error": "error",
		"session.idle": "idle",
	};
	return mapping[eventType] ?? null;
};

const RESULT_SUMMARY_MAX_LENGTH = 500; // Longer summaries to preserve context

/**
 * Create a summary from tool output, truncating if necessary.
 */
const createResultSummary = (
	output: string,
	maxLength = RESULT_SUMMARY_MAX_LENGTH,
): string => {
	if (output.length <= maxLength) {
		return output;
	}
	return output.substring(0, maxLength - 3) + "...";
};

/**
 * Safely stringify args, handling circular references.
 */
const safeStringify = (args: unknown): string => {
	try {
		return JSON.stringify(args);
	} catch {
		return "[Unable to serialize args]";
	}
};

// =============================================================================
// Plugin Export
// =============================================================================

const AuditTrailPlugin: Plugin = async (_ctx) => {
	// Start the cleanup interval for expired pending calls
	startCleanupInterval();

	return {
		/**
		 * Handle session lifecycle events.
		 */
		event: async ({ event }: { event: Event }) => {
			const eventType = mapEventType(event.type);

			// Only log session events we care about
			if (!eventType) {
				return;
			}

			// Extract session ID from event properties if available
			const sessionId = (event.properties as Record<string, unknown>)
				?.sessionID as string | undefined;

			if (!sessionId) {
				return;
			}

			logSessionEvent({
				sessionId,
				eventType,
				detailsJson: safeStringify(event.properties),
			});
		},

		/**
		 * Log tool execution start.
		 */
		"tool.execute.before": async (input, output) => {
			const startTime = Date.now();

			const rowId = logToolExecution({
				sessionId: input.sessionID,
				callId: input.callID,
				toolName: input.tool,
				argsJson: safeStringify(output.args),
				decision: "started",
			});

			// Track this call for completion
			pendingCalls.set(input.callID, {
				rowId,
				startTime,
				expiry: Date.now() + PENDING_CALL_TTL_MS,
			});
		},

		/**
		 * Log tool execution completion.
		 */
		"tool.execute.after": async (input, output) => {
			const pending = pendingCalls.get(input.callID);

			if (!pending) {
				// No matching start event, log as standalone completion
				logToolExecution({
					sessionId: input.sessionID,
					callId: input.callID,
					toolName: input.tool,
					decision: "completed",
					resultSummary: createResultSummary(output.output ?? ""),
				});
				return;
			}

			// Calculate duration and update the existing row
			const durationMs = Date.now() - pending.startTime;

			// Determine if this was a failure based on output content
			// (heuristic: look for error indicators in the output)
			const lowerOutput = (output.output ?? "").toLowerCase();
			const isFailure =
				(output.metadata as Record<string, unknown>)?.error === true ||
				lowerOutput.match(/\b(error|failed):\s/i) !== null;

			updateToolExecution(
				pending.rowId,
				isFailure ? "failed" : "completed",
				createResultSummary(output.output ?? ""),
				durationMs,
			);

			// Clean up tracking
			pendingCalls.delete(input.callID);
		},

		// =========================================================================
		// Custom Tools for Query API
		// =========================================================================

		tool: {
		audit_stats: tool({
			description:
				"Get overall tool execution statistics from the audit trail. Optional params: since (ISO timestamp), session_id",
			args: {},
			async execute(args) {
				const typedArgs = args as { since?: string; session_id?: string };
				try {
					const filter = {
						since: parseOptionalDate(typedArgs.since),
						sessionId: typedArgs.session_id,
					};
					const stats = getToolStats(filter);
					return JSON.stringify(stats, null, 2);
				} catch (error) {
					return `Error: Failed to get audit stats: ${error instanceof Error ? error.message : String(error)}`;
				}
			},
		}),

			audit_tool_usage: tool({
				description: "Get tool usage breakdown from the audit trail",
				args: {
					since: tool.schema
						.string()
						.optional()
						.describe("ISO timestamp to filter from"),
					limit: tool.schema
						.number()
						.optional()
						.describe("Max results, default 15"),
				},
				async execute(args) {
					try {
						const filter = {
							since: parseOptionalDate(args.since),
						};
						const usage = getToolUsage(filter, args.limit ?? 15);
						return JSON.stringify(usage, null, 2);
					} catch (error) {
						return `Error: Failed to get tool usage: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),

			audit_session_timeline: tool({
				description: "Get timeline of all events for a specific session",
				args: {
					session_id: tool.schema.string().describe("The session ID to query"),
				},
				async execute(args) {
					try {
						const timeline = getSessionTimeline(args.session_id);
						return JSON.stringify(timeline, null, 2);
					} catch (error) {
						return `Error: Failed to get session timeline: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),

			audit_export_logs: tool({
				description: "Export audit logs with optional filters",
				args: {
					since: tool.schema
						.string()
						.optional()
						.describe("ISO timestamp to filter from"),
					session_id: tool.schema
						.string()
						.optional()
						.describe("Filter by session ID"),
					tool_name: tool.schema
						.string()
						.optional()
						.describe("Filter by tool name"),
					limit: tool.schema
						.number()
						.optional()
						.describe("Max results, default 1000"),
				},
				async execute(args) {
					try {
						const filter = {
							since: parseOptionalDate(args.since),
							sessionId: args.session_id,
							toolName: args.tool_name,
							limit: args.limit ?? 1000,
						};
						const logs = getLogs(filter);
						return JSON.stringify(logs, null, 2);
					} catch (error) {
						return `Error: Failed to export logs: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),
		},
	};
};

export default AuditTrailPlugin;
