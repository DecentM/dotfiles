/**
 * Audit Trail Plugin for OpenCode
 *
 * Logs all tool executions and session events to a SQLite database
 * for comprehensive audit trail and analytics.
 */

import { type Event, type Plugin, type PluginContext, tool } from "@opencode-ai/plugin";
import { randomUUID } from "node:crypto";

import {
	getLogs,
	getSessionTimeline,
	getToolStats,
	getToolUsage,
	logSessionEvent,
	logToolExecution,
	setDbErrorHandler,
	updateToolExecution,
} from "./db";
import { startMetricsServer, stopMetricsServer } from "./prometheus";
import type { SessionEventType } from "./types";

// =============================================================================
// Logging Configuration
// =============================================================================

const LOG_LEVEL = (process.env.OPENCODE_AUDIT_LOG_LEVEL ?? "info").toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

type LogLevel = keyof typeof LOG_LEVELS;

const shouldLog = (level: LogLevel): boolean => {
	const currentLevel = LOG_LEVELS[LOG_LEVEL as LogLevel] ?? LOG_LEVELS.info;
	return LOG_LEVELS[level] >= currentLevel;
};

// Store client reference for logging
let pluginClient: PluginContext["client"] | null = null;

/**
 * Structured logging using OpenCode's logging API.
 */
const log = async (
	level: LogLevel,
	message: string,
	extra?: Record<string, unknown>
): Promise<void> => {
	if (!shouldLog(level) || !pluginClient) {
		return;
	}
	try {
		await pluginClient.app.log({
			service: "audit-trail",
			level,
			message,
			extra,
		});
	} catch {
		// Fallback silently - don't cause issues if logging fails
	}
};

// =============================================================================
// Sensitive Data Sanitization
// =============================================================================

const SENSITIVE_KEY_PATTERN = /^(password|secret|token|key|apikey|api_key|auth|credential|private)$/i;

/**
 * Recursively sanitize sensitive keys in an object.
 */
const sanitizeArgs = (value: unknown): unknown => {
	if (value === null || value === undefined) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(sanitizeArgs);
	}

	if (typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			if (SENSITIVE_KEY_PATTERN.test(key)) {
				sanitized[key] = "[REDACTED]";
			} else {
				sanitized[key] = sanitizeArgs(val);
			}
		}
		return sanitized;
	}

	return value;
};

// =============================================================================
// Prometheus Server Lifecycle
// =============================================================================

const METRICS_PORT = Number.parseInt(process.env.OPENCODE_METRICS_PORT ?? "", 10) || 9090;

// Start the Prometheus metrics server when the plugin loads
// Returns false if port is in use (e.g., another instance running) - this is fine
startMetricsServer(METRICS_PORT);

// Register cleanup handlers to stop the server on process exit
const cleanup = (): void => {
	stopMetricsServer();
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
	cleanup();
	process.exit(0);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(0);
});

// =============================================================================
// In-Memory Tracking
// =============================================================================

const PENDING_CALL_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Track in-flight tool calls: callId -> { rowId, startTime, expiry, correlationId }
 */
const pendingCalls = new Map<
	string,
	{ rowId: number; startTime: number; expiry: number; correlationId: string }
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
		1 * 60 * 1000, // 1 minute cleanup interval
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
	return `${output.substring(0, maxLength - 3)}...`;
};

/**
 * Safely stringify args, handling circular references and sanitizing sensitive data.
 */
const safeStringify = (args: unknown): string => {
	try {
		const sanitized = sanitizeArgs(args);
		return JSON.stringify(sanitized);
	} catch {
		return "[Unable to serialize args]";
	}
};

// =============================================================================
// Plugin Export
// =============================================================================

const AuditTrailPlugin: Plugin = async (ctx) => {
	// Store client reference for structured logging
	pluginClient = ctx.client;

	// Configure database error handler to use structured logging
	setDbErrorHandler((operation, error) => {
		log("error", `Database error in ${operation}`, {
			operation,
			error: error instanceof Error ? error.message : String(error),
		});
	});

	// Start the cleanup interval for expired pending calls
	startCleanupInterval();

	await log("info", "Audit trail plugin initialized", {
		metricsPort: METRICS_PORT,
		logLevel: LOG_LEVEL,
	});

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

			await log("debug", `Session event: ${eventType}`, {
				sessionId,
				eventType,
			});
		},

		/**
		 * Log tool execution start.
		 */
		"tool.execute.before": async (input, output) => {
			const startTime = Date.now();
			const correlationId = randomUUID();

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
				correlationId,
			});

			await log("debug", `Tool execution started: ${input.tool}`, {
				correlationId,
				tool: input.tool,
				sessionId: input.sessionID,
				callId: input.callID,
			});
		},

		/**
		 * Log tool execution completion.
		 */
		"tool.execute.after": async (input, output) => {
			const pending = pendingCalls.get(input.callID);
			const correlationId = pending?.correlationId ?? randomUUID();

			if (!pending) {
				// No matching start event, log as standalone completion
				logToolExecution({
					sessionId: input.sessionID,
					callId: input.callID,
					toolName: input.tool,
					decision: "completed",
					resultSummary: createResultSummary(output.output ?? ""),
				});

				await log("warn", `Tool execution completed without matching start: ${input.tool}`, {
					correlationId,
					tool: input.tool,
					sessionId: input.sessionID,
					callId: input.callID,
				});
				return;
			}

			// Calculate duration and update the existing row
			const durationMs = Date.now() - pending.startTime;

			// Determine if this was a failure based on explicit metadata checks
			const metadata = output.metadata as Record<string, unknown> | undefined;
			const isFailure =
				metadata?.error === true ||
				(metadata?.exitCode !== undefined && metadata.exitCode !== 0) ||
				metadata?.success === false;

			updateToolExecution(
				pending.rowId,
				isFailure ? "failed" : "completed",
				createResultSummary(output.output ?? ""),
				durationMs,
			);

			// Clean up tracking
			pendingCalls.delete(input.callID);

			await log("debug", `Tool execution ${isFailure ? "failed" : "completed"}: ${input.tool}`, {
				correlationId,
				tool: input.tool,
				sessionId: input.sessionID,
				callId: input.callID,
				durationMs,
				isFailure,
			});
		},

		// =========================================================================
		// Custom Tools for Query API
		// =========================================================================

		tool: {
			audit_stats: tool({
				description:
					"Get overall tool execution statistics from the audit trail. Optional params: since (ISO timestamp), before (ISO timestamp), session_id",
				args: {
					since: tool.schema.string().optional().describe("ISO timestamp to filter from"),
					before: tool.schema.string().optional().describe("ISO timestamp to filter until"),
					session_id: tool.schema.string().optional().describe("Filter by session ID"),
				},
				async execute(args, ctx) {
					try {
						const filter = {
							since: parseOptionalDate(args.since),
							before: parseOptionalDate(args.before),
							sessionId: args.session_id,
						};
						const stats = getToolStats(filter);
						return JSON.stringify(stats, null, 2);
					} catch (error) {
						return `Error: Failed to get audit stats: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),

			audit_tool_usage: tool({
				description:
					"Get tool usage breakdown from the audit trail. Optional params: since (ISO timestamp), before (ISO timestamp), limit (max results, default 15)",
				args: {
					since: tool.schema.string().optional().describe("ISO timestamp to filter from"),
					before: tool.schema.string().optional().describe("ISO timestamp to filter until"),
					limit: tool.schema.number().optional().describe("Maximum number of results (default 15)"),
				},
				async execute(args, ctx) {
					try {
						const filter = {
							since: parseOptionalDate(args.since),
							before: parseOptionalDate(args.before),
						};
						const usage = getToolUsage(filter, args.limit ?? 15);
						return JSON.stringify(usage, null, 2);
					} catch (error) {
						return `Error: Failed to get tool usage: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),

			audit_session_timeline: tool({
				description:
					"Get timeline of all events for a specific session. Required param: session_id",
				args: {
					session_id: tool.schema.string().describe("The session ID to get timeline for (required)"),
				},
				async execute(args, ctx) {
					try {
						if (!args.session_id) {
							return "Error: session_id is required";
						}
						const timeline = getSessionTimeline(args.session_id);
						return JSON.stringify(timeline, null, 2);
					} catch (error) {
						return `Error: Failed to get session timeline: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			}),

			audit_export_logs: tool({
				description:
					"Export audit logs with optional filters. Optional params: since (ISO timestamp), before (ISO timestamp), session_id, tool_name, limit (max results, default 1000)",
				args: {
					since: tool.schema.string().optional().describe("ISO timestamp to filter from"),
					before: tool.schema.string().optional().describe("ISO timestamp to filter until"),
					session_id: tool.schema.string().optional().describe("Filter by session ID"),
					tool_name: tool.schema.string().optional().describe("Filter by tool name"),
					limit: tool.schema.number().optional().describe("Maximum number of results (default 1000)"),
				},
				async execute(args, ctx) {
					try {
						const filter = {
							since: parseOptionalDate(args.since),
							before: parseOptionalDate(args.before),
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
