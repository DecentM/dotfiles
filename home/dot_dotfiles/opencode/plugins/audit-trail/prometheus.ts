/**
 * Prometheus metrics exporter for the audit-trail plugin.
 *
 * Exposes audit trail metrics in Prometheus text format via HTTP.
 * Uses only Bun builtins (Bun.serve for HTTP server).
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { dbManager } from "./db";
import type { SessionEventType, ToolDecision } from "./types";

// =============================================================================
// Sh Tool Imports (optional - gracefully handles missing)
// =============================================================================

import type {
	ShCommandCount,
	ShDeniedByPattern,
	ShDurationEntry,
} from "../../tools/sh";

let getCommandCountsByBaseCommand: (() => ShCommandCount[]) | null = null;
let getCommandDurationsForHistogram: (() => ShDurationEntry[]) | null = null;
let getDeniedCommandsByPattern: (() => ShDeniedByPattern[]) | null = null;

try {
	const shModule = require("../../tools/sh") as typeof import("../../tools/sh");
	getCommandCountsByBaseCommand = shModule.getCommandCountsByBaseCommand;
	getCommandDurationsForHistogram = shModule.getCommandDurationsForHistogram;
	getDeniedCommandsByPattern = shModule.getDeniedCommandsByPattern;
} catch {
	// Sh tool not available - metrics will be empty
	console.warn("[audit-trail] Sh tool not available for metrics collection");
}

// =============================================================================
// Types
// =============================================================================

export interface MetricsData {
	toolExecutions: ToolExecutionMetric[];
	toolDurations: ToolDurationMetric[];
	inProgressCount: number;
	sessionEvents: SessionEventMetric[];
	activeSessionCount: number;
	dbSizeBytes: number;
	// Sh tool metrics (optional - may be empty if sh tool unavailable)
	shCommandCounts: ShCommandMetric[];
	shCommandDurations: ShDurationMetric[];
	shDeniedCommands: ShDeniedMetric[];
}

export interface ToolExecutionMetric {
	toolName: string;
	decision: ToolDecision;
	count: number;
}

export interface ToolDurationMetric {
	toolName: string;
	count: number;
	sum: number;
	buckets: Record<string, number>;
}

export interface SessionEventMetric {
	eventType: SessionEventType;
	count: number;
}

// Sh tool specific metrics
export interface ShCommandMetric {
	command: string;
	decision: "allow" | "deny";
	count: number;
}

export interface ShDurationMetric {
	command: string;
	count: number;
	sum: number;
	buckets: Record<string, number>;
}

export interface ShDeniedMetric {
	command: string;
	pattern: string;
	count: number;
}

// =============================================================================
// Constants
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "audit-trail.db");

// Histogram buckets for duration (in seconds)
const DURATION_BUCKETS = [
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// =============================================================================
// Server State
// =============================================================================

let server: ReturnType<typeof Bun.serve> | null = null;

// =============================================================================
// Metrics Query Functions
// =============================================================================

/**
 * Get tool execution counts grouped by tool name and decision.
 */
export const getToolExecutionCounts = (): ToolExecutionMetric[] => {
	const db = dbManager.get();

	const rows = db
		.query(
			`SELECT tool_name, decision, COUNT(*) as count
       FROM tool_execution_log
       GROUP BY tool_name, decision`,
		)
		.all() as Array<{
		tool_name: string;
		decision: string;
		count: number;
	}>;

	return rows.map((row) => ({
		toolName: row.tool_name,
		decision: row.decision as ToolDecision,
		count: row.count,
	}));
};

/**
 * Get tool execution duration metrics for histogram.
 */
export const getToolDurationMetrics = (): ToolDurationMetric[] => {
	const db = dbManager.get();

	// Get all completed/failed executions with durations
	const rows = db
		.query(
			`SELECT tool_name, duration_ms
       FROM tool_execution_log
       WHERE decision IN ('completed', 'failed') AND duration_ms IS NOT NULL`,
		)
		.all() as Array<{
		tool_name: string;
		duration_ms: number;
	}>;

	// Group by tool name and calculate histogram buckets
	const metrics = new Map<string, ToolDurationMetric>();

	for (const row of rows) {
		const durationSec = row.duration_ms / 1000;

		let metric = metrics.get(row.tool_name);
		if (!metric) {
			metric = {
				toolName: row.tool_name,
				count: 0,
				sum: 0,
				buckets: {},
			};
			// Initialize buckets
			for (const bucket of DURATION_BUCKETS) {
				metric.buckets[bucket.toString()] = 0;
			}
			metric.buckets["+Inf"] = 0;
			metrics.set(row.tool_name, metric);
		}

		metric.count++;
		metric.sum += durationSec;

		// Update bucket counts (cumulative)
		for (const bucket of DURATION_BUCKETS) {
			if (durationSec <= bucket) {
				metric.buckets[bucket.toString()]++;
			}
		}
		metric.buckets["+Inf"]++;
	}

	return Array.from(metrics.values());
};

/**
 * Get count of currently in-progress tool executions.
 */
export const getInProgressCount = (): number => {
	const db = dbManager.get();

	const row = db
		.query(
			`SELECT COUNT(*) as count
       FROM tool_execution_log
       WHERE decision = 'started'
         AND call_id NOT IN (
           SELECT call_id
           FROM tool_execution_log
           WHERE decision IN ('completed', 'failed') AND call_id IS NOT NULL
         )`,
		)
		.get() as { count: number };

	return row.count;
};

/**
 * Get session event counts grouped by event type.
 */
export const getSessionEventCounts = (): SessionEventMetric[] => {
	const db = dbManager.get();

	const rows = db
		.query(
			`SELECT event_type, COUNT(*) as count
       FROM session_log
       GROUP BY event_type`,
		)
		.all() as Array<{
		event_type: string;
		count: number;
	}>;

	return rows.map((row) => ({
		eventType: row.event_type as SessionEventType,
		count: row.count,
	}));
};

/**
 * Get count of active sessions (created but not deleted).
 */
export const getActiveSessionCount = (): number => {
	const db = dbManager.get();

	const row = db
		.query(
			`SELECT COUNT(DISTINCT session_id) as count
       FROM session_log
       WHERE session_id NOT IN (
         SELECT session_id FROM session_log WHERE event_type = 'deleted'
       ) AND event_type = 'created'`,
		)
		.get() as { count: number };

	return row.count;
};

/**
 * Get database file size in bytes.
 */
export const getDatabaseSize = (): number => {
	try {
		const stats = statSync(DB_PATH);
		return stats.size;
	} catch {
		return 0;
	}
};

// =============================================================================
// Sh Tool Metrics Query Functions
// =============================================================================

/**
 * Get sh command counts grouped by base command and decision.
 */
export const getShCommandCounts = (): ShCommandMetric[] => {
	if (!getCommandCountsByBaseCommand) {
		return [];
	}

	try {
		const counts = getCommandCountsByBaseCommand();
		return counts.map((c) => ({
			command: c.command,
			decision: c.decision,
			count: c.count,
		}));
	} catch {
		return [];
	}
};

/**
 * Get sh command duration metrics for histogram.
 */
export const getShDurationMetrics = (): ShDurationMetric[] => {
	if (!getCommandDurationsForHistogram) {
		return [];
	}

	try {
		const entries = getCommandDurationsForHistogram();

		// Group by command and calculate histogram buckets
		const metrics = new Map<string, ShDurationMetric>();

		for (const entry of entries) {
			const durationSec = entry.durationMs / 1000;

			let metric = metrics.get(entry.command);
			if (!metric) {
				metric = {
					command: entry.command,
					count: 0,
					sum: 0,
					buckets: {},
				};
				// Initialize buckets
				for (const bucket of DURATION_BUCKETS) {
					metric.buckets[bucket.toString()] = 0;
				}
				metric.buckets["+Inf"] = 0;
				metrics.set(entry.command, metric);
			}

			metric.count++;
			metric.sum += durationSec;

			// Update bucket counts (cumulative)
			for (const bucket of DURATION_BUCKETS) {
				if (durationSec <= bucket) {
					metric.buckets[bucket.toString()]++;
				}
			}
			metric.buckets["+Inf"]++;
		}

		return Array.from(metrics.values());
	} catch {
		return [];
	}
};

/**
 * Get sh denied commands grouped by command and pattern.
 */
export const getShDeniedCommands = (): ShDeniedMetric[] => {
	if (!getDeniedCommandsByPattern) {
		return [];
	}

	try {
		const denied = getDeniedCommandsByPattern();
		return denied.map((d) => ({
			command: d.command,
			pattern: d.pattern,
			count: d.count,
		}));
	} catch {
		return [];
	}
};

/**
 * Default empty metrics for when collection fails.
 */
const EMPTY_METRICS: MetricsData = {
	toolExecutions: [],
	toolDurations: [],
	inProgressCount: 0,
	sessionEvents: [],
	activeSessionCount: 0,
	dbSizeBytes: 0,
	shCommandCounts: [],
	shCommandDurations: [],
	shDeniedCommands: [],
};

/**
 * Collect all metrics data.
 * Returns empty metrics if database is unavailable or queries fail.
 */
export const collectMetrics = (): MetricsData => {
	try {
		return {
			toolExecutions: getToolExecutionCounts(),
			toolDurations: getToolDurationMetrics(),
			inProgressCount: getInProgressCount(),
			sessionEvents: getSessionEventCounts(),
			activeSessionCount: getActiveSessionCount(),
			dbSizeBytes: getDatabaseSize(),
			shCommandCounts: getShCommandCounts(),
			shCommandDurations: getShDurationMetrics(),
			shDeniedCommands: getShDeniedCommands(),
		};
	} catch (error) {
		console.error("[audit-trail] Error collecting metrics:", error);
		return EMPTY_METRICS;
	}
};

// =============================================================================
// Prometheus Format Helpers
// =============================================================================

/**
 * Escape label values for Prometheus format.
 */
const escapeLabelValue = (value: string): string => {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n");
};

/**
 * Format a metric line with labels.
 */
const formatMetricLine = (
	name: string,
	labels: Record<string, string>,
	value: number,
): string => {
	const labelParts = Object.entries(labels)
		.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
		.join(",");
	return `${name}{${labelParts}} ${value}`;
};

/**
 * Format a metric line without labels.
 */
const formatSimpleMetricLine = (name: string, value: number): string => {
	return `${name} ${value}`;
};

// =============================================================================
// Metrics Formatting
// =============================================================================

/**
 * Format metrics data in Prometheus text format.
 */
export const formatMetrics = (data?: MetricsData): string => {
	const rawMetrics = data ?? collectMetrics();

	// Defensive merge with empty defaults to handle partial/undefined metrics
	const metrics: MetricsData = {
		toolExecutions: rawMetrics?.toolExecutions ?? [],
		toolDurations: rawMetrics?.toolDurations ?? [],
		inProgressCount: rawMetrics?.inProgressCount ?? 0,
		sessionEvents: rawMetrics?.sessionEvents ?? [],
		activeSessionCount: rawMetrics?.activeSessionCount ?? 0,
		dbSizeBytes: rawMetrics?.dbSizeBytes ?? 0,
		shCommandCounts: rawMetrics?.shCommandCounts ?? [],
		shCommandDurations: rawMetrics?.shCommandDurations ?? [],
		shDeniedCommands: rawMetrics?.shDeniedCommands ?? [],
	};

	const lines: string[] = [];

	// Tool executions total (counter)
	lines.push(
		"# HELP opencode_tool_executions_total Total number of tool executions",
	);
	lines.push("# TYPE opencode_tool_executions_total counter");
	for (const metric of metrics.toolExecutions) {
		lines.push(
			formatMetricLine(
				"opencode_tool_executions_total",
				{
					tool_name: metric.toolName,
					decision: metric.decision,
				},
				metric.count,
			),
		);
	}

	// Tool execution duration histogram
	lines.push("");
	lines.push(
		"# HELP opencode_tool_execution_duration_seconds Duration of tool executions in seconds",
	);
	lines.push("# TYPE opencode_tool_execution_duration_seconds histogram");
	for (const metric of metrics.toolDurations) {
		// Bucket lines
		for (const bucket of DURATION_BUCKETS) {
			const bucketKey = bucket.toString();
			lines.push(
				formatMetricLine(
					"opencode_tool_execution_duration_seconds_bucket",
					{
						tool_name: metric.toolName,
						le: bucketKey,
					},
					metric.buckets[bucketKey] ?? 0,
				),
			);
		}
		// +Inf bucket
		lines.push(
			formatMetricLine(
				"opencode_tool_execution_duration_seconds_bucket",
				{
					tool_name: metric.toolName,
					le: "+Inf",
				},
				metric.buckets["+Inf"] ?? 0,
			),
		);
		// Sum and count
		lines.push(
			formatMetricLine(
				"opencode_tool_execution_duration_seconds_sum",
				{
					tool_name: metric.toolName,
				},
				metric.sum,
			),
		);
		lines.push(
			formatMetricLine(
				"opencode_tool_execution_duration_seconds_count",
				{
					tool_name: metric.toolName,
				},
				metric.count,
			),
		);
	}

	// In-progress tool executions (gauge)
	lines.push("");
	lines.push(
		"# HELP opencode_tool_executions_in_progress Number of tool executions currently in progress",
	);
	lines.push("# TYPE opencode_tool_executions_in_progress gauge");
	lines.push(
		formatSimpleMetricLine(
			"opencode_tool_executions_in_progress",
			metrics.inProgressCount,
		),
	);

	// Session events total (counter)
	lines.push("");
	lines.push("# HELP opencode_sessions_total Total number of session events");
	lines.push("# TYPE opencode_sessions_total counter");
	for (const metric of metrics.sessionEvents) {
		lines.push(
			formatMetricLine(
				"opencode_sessions_total",
				{
					event_type: metric.eventType,
				},
				metric.count,
			),
		);
	}

	// Active sessions (gauge)
	lines.push("");
	lines.push(
		"# HELP opencode_active_sessions Number of currently active sessions",
	);
	lines.push("# TYPE opencode_active_sessions gauge");
	lines.push(
		formatSimpleMetricLine(
			"opencode_active_sessions",
			metrics.activeSessionCount,
		),
	);

	// Database size (gauge)
	lines.push("");
	lines.push(
		"# HELP opencode_audit_db_size_bytes Size of the audit database file in bytes",
	);
	lines.push("# TYPE opencode_audit_db_size_bytes gauge");
	lines.push(
		formatSimpleMetricLine("opencode_audit_db_size_bytes", metrics.dbSizeBytes),
	);

	// =========================================================================
	// Sh Tool Metrics
	// =========================================================================

	// Sh commands total (counter)
	lines.push("");
	lines.push(
		"# HELP opencode_sh_commands_total Total number of shell commands by base command and decision",
	);
	lines.push("# TYPE opencode_sh_commands_total counter");
	for (const metric of metrics.shCommandCounts) {
		lines.push(
			formatMetricLine(
				"opencode_sh_commands_total",
				{
					command: metric.command,
					decision: metric.decision,
				},
				metric.count,
			),
		);
	}

	// Sh command duration histogram
	lines.push("");
	lines.push(
		"# HELP opencode_sh_command_duration_seconds Duration of shell command executions in seconds",
	);
	lines.push("# TYPE opencode_sh_command_duration_seconds histogram");
	for (const metric of metrics.shCommandDurations) {
		// Bucket lines
		for (const bucket of DURATION_BUCKETS) {
			const bucketKey = bucket.toString();
			lines.push(
				formatMetricLine(
					"opencode_sh_command_duration_seconds_bucket",
					{
						command: metric.command,
						le: bucketKey,
					},
					metric.buckets[bucketKey] ?? 0,
				),
			);
		}
		// +Inf bucket
		lines.push(
			formatMetricLine(
				"opencode_sh_command_duration_seconds_bucket",
				{
					command: metric.command,
					le: "+Inf",
				},
				metric.buckets["+Inf"] ?? 0,
			),
		);
		// Sum and count
		lines.push(
			formatMetricLine(
				"opencode_sh_command_duration_seconds_sum",
				{
					command: metric.command,
				},
				metric.sum,
			),
		);
		lines.push(
			formatMetricLine(
				"opencode_sh_command_duration_seconds_count",
				{
					command: metric.command,
				},
				metric.count,
			),
		);
	}

	// Sh denied commands total (counter)
	lines.push("");
	lines.push(
		"# HELP opencode_sh_denied_commands_total Total number of denied shell commands by command and pattern",
	);
	lines.push("# TYPE opencode_sh_denied_commands_total counter");
	for (const metric of metrics.shDeniedCommands) {
		lines.push(
			formatMetricLine(
				"opencode_sh_denied_commands_total",
				{
					command: metric.command,
					pattern: metric.pattern,
				},
				metric.count,
			),
		);
	}

	return lines.join("\n") + "\n";
};

// =============================================================================
// HTTP Server
// =============================================================================

/**
 * Start the Prometheus metrics HTTP server.
 * @param port Port to listen on (default: 9090)
 * @returns true if server started successfully, false otherwise
 */
export const startMetricsServer = (port = 9090): boolean => {
	if (server) {
		return true; // Already running
	}

	try {
		server = Bun.serve({
			port,
			fetch(request) {
				const url = new URL(request.url);

				if (request.method === "GET" && url.pathname === "/metrics") {
					try {
						const metricsOutput = formatMetrics();
						return new Response(metricsOutput, {
							status: 200,
							headers: {
								"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
							},
						});
					} catch (error) {
						console.error("[audit-trail] Error generating metrics:", error);
						return new Response("Internal Server Error", { status: 500 });
					}
				}

				if (request.method === "GET" && url.pathname === "/health") {
					return new Response("OK", { status: 200 });
				}

				return new Response("Not Found", { status: 404 });
			},
		});

		console.log(
			`[audit-trail] Prometheus metrics server started on port ${server.port}`,
		);
		return true;
	} catch (error) {
		if (error instanceof Error && error.message.includes("EADDRINUSE")) {
			console.log(
				`[audit-trail] Prometheus metrics server not started: port ${port} already in use`,
			);
			return false;
		}
		// Log other errors but don't crash
		console.error("[audit-trail] Failed to start Prometheus server:", error);
		return false;
	}
};

/**
 * Stop the Prometheus metrics HTTP server.
 */
export const stopMetricsServer = (): void => {
	if (server) {
		server.stop();
		server = null;
		console.log("[audit-trail] Prometheus metrics server stopped");
	}
};

/**
 * Check if the metrics server is running.
 */
export const isMetricsServerRunning = (): boolean => {
	return server !== null;
};

/**
 * Get the port the metrics server is listening on.
 * Returns null if the server is not running.
 */
export const getMetricsServerPort = (): number | null => {
	return server?.port ?? null;
};
