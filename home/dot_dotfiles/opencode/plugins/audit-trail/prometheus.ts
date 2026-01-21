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
// Types
// =============================================================================

export interface MetricsData {
	toolExecutions: ToolExecutionMetric[];
	toolDurations: ToolDurationMetric[];
	inProgressCount: number;
	sessionEvents: SessionEventMetric[];
	activeSessionCount: number;
	dbSizeBytes: number;
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

	return lines.join("\n") + "\n";
};

// =============================================================================
// HTTP Server
// =============================================================================

/**
 * Start the Prometheus metrics HTTP server.
 * @param port Port to listen on (default: 9090)
 * @returns The port the server is listening on
 */
export const startMetricsServer = (port = 9090): number => {
	if (server) {
		console.warn("[audit-trail] Prometheus metrics server already running");
		return server.port;
	}

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
	return server.port;
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
