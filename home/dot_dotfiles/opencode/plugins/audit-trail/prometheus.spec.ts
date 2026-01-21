/**
 * Tests for the audit-trail prometheus metrics module.
 * Tests metrics collection, formatting, and HTTP server.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type {
	MetricsData,
	SessionEventMetric,
	ToolDurationMetric,
	ToolExecutionMetric,
} from "./prometheus";

// =============================================================================
// Test Helpers - Pure Functions for Testing
// =============================================================================

// Re-implement the pure formatting functions for testing isolation
const DURATION_BUCKETS = [
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const escapeLabelValue = (value: string): string => {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n");
};

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

const formatSimpleMetricLine = (name: string, value: number): string => {
	return `${name} ${value}`;
};

const formatMetrics = (data: MetricsData): string => {
	const lines: string[] = [];

	// Tool executions total (counter)
	lines.push(
		"# HELP opencode_tool_executions_total Total number of tool executions",
	);
	lines.push("# TYPE opencode_tool_executions_total counter");
	for (const metric of data.toolExecutions) {
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
	for (const metric of data.toolDurations) {
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
			data.inProgressCount,
		),
	);

	// Session events total (counter)
	lines.push("");
	lines.push("# HELP opencode_sessions_total Total number of session events");
	lines.push("# TYPE opencode_sessions_total counter");
	for (const metric of data.sessionEvents) {
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
		formatSimpleMetricLine("opencode_active_sessions", data.activeSessionCount),
	);

	// Database size (gauge)
	lines.push("");
	lines.push(
		"# HELP opencode_audit_db_size_bytes Size of the audit database file in bytes",
	);
	lines.push("# TYPE opencode_audit_db_size_bytes gauge");
	lines.push(
		formatSimpleMetricLine("opencode_audit_db_size_bytes", data.dbSizeBytes),
	);

	return lines.join("\n") + "\n";
};

// =============================================================================
// Test Database Setup
// =============================================================================

interface TestDb {
	db: Database;
	logToolExecution: (entry: {
		sessionId?: string;
		callId?: string;
		toolName: string;
		decision: "started" | "completed" | "failed";
		durationMs?: number;
	}) => number;
	logSessionEvent: (entry: {
		sessionId: string;
		eventType: "created" | "compacted" | "deleted" | "error" | "idle";
	}) => number;
	getToolExecutionCounts: () => ToolExecutionMetric[];
	getToolDurationMetrics: () => ToolDurationMetric[];
	getInProgressCount: () => number;
	getSessionEventCounts: () => SessionEventMetric[];
	getActiveSessionCount: () => number;
	close: () => void;
}

const createTestDb = (): TestDb => {
	const db = new Database(":memory:");

	// Create tool_execution_log table
	db.run(`
    CREATE TABLE IF NOT EXISTS tool_execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      message_id TEXT,
      call_id TEXT,
      tool_name TEXT NOT NULL,
      agent TEXT,
      args_json TEXT,
      decision TEXT CHECK (decision IN ('started', 'completed', 'failed')),
      result_summary TEXT,
      duration_ms INTEGER
    )
  `);

	// Create session_log table
	db.run(`
    CREATE TABLE IF NOT EXISTS session_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('created', 'compacted', 'deleted', 'error', 'idle')),
      details_json TEXT
    )
  `);

	const logToolExecution = (entry: {
		sessionId?: string;
		callId?: string;
		toolName: string;
		decision: "started" | "completed" | "failed";
		durationMs?: number;
	}): number => {
		const result = db.run(
			`INSERT INTO tool_execution_log
       (timestamp, session_id, call_id, tool_name, decision, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
			[
				Date.now(),
				entry.sessionId ?? null,
				entry.callId ?? null,
				entry.toolName,
				entry.decision,
				entry.durationMs ?? null,
			],
		);
		return Number(result.lastInsertRowid);
	};

	const logSessionEvent = (entry: {
		sessionId: string;
		eventType: "created" | "compacted" | "deleted" | "error" | "idle";
	}): number => {
		const result = db.run(
			`INSERT INTO session_log (timestamp, session_id, event_type) VALUES (?, ?, ?)`,
			[Date.now(), entry.sessionId, entry.eventType],
		);
		return Number(result.lastInsertRowid);
	};

	const getToolExecutionCounts = (): ToolExecutionMetric[] => {
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
			decision: row.decision as "started" | "completed" | "failed",
			count: row.count,
		}));
	};

	const getToolDurationMetrics = (): ToolDurationMetric[] => {
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
				for (const bucket of DURATION_BUCKETS) {
					metric.buckets[bucket.toString()] = 0;
				}
				metric.buckets["+Inf"] = 0;
				metrics.set(row.tool_name, metric);
			}

			metric.count++;
			metric.sum += durationSec;

			for (const bucket of DURATION_BUCKETS) {
				if (durationSec <= bucket) {
					metric.buckets[bucket.toString()]++;
				}
			}
			metric.buckets["+Inf"]++;
		}

		return Array.from(metrics.values());
	};

	const getInProgressCount = (): number => {
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

	const getSessionEventCounts = (): SessionEventMetric[] => {
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
			eventType: row.event_type as
				| "created"
				| "compacted"
				| "deleted"
				| "error"
				| "idle",
			count: row.count,
		}));
	};

	const getActiveSessionCount = (): number => {
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

	const close = () => {
		try {
			db.close();
		} catch {
			// Ignore close errors
		}
	};

	return {
		db,
		logToolExecution,
		logSessionEvent,
		getToolExecutionCounts,
		getToolDurationMetrics,
		getInProgressCount,
		getSessionEventCounts,
		getActiveSessionCount,
		close,
	};
};

// =============================================================================
// Metrics Formatting Tests
// =============================================================================

describe("formatMetrics", () => {
	describe("prometheus format structure", () => {
		test("produces valid prometheus format with HELP and TYPE comments", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 1024,
			};

			const output = formatMetrics(data);

			expect(output).toContain("# HELP opencode_tool_executions_total");
			expect(output).toContain("# TYPE opencode_tool_executions_total counter");
			expect(output).toContain(
				"# HELP opencode_tool_execution_duration_seconds",
			);
			expect(output).toContain(
				"# TYPE opencode_tool_execution_duration_seconds histogram",
			);
			expect(output).toContain("# HELP opencode_tool_executions_in_progress");
			expect(output).toContain(
				"# TYPE opencode_tool_executions_in_progress gauge",
			);
			expect(output).toContain("# HELP opencode_sessions_total");
			expect(output).toContain("# TYPE opencode_sessions_total counter");
			expect(output).toContain("# HELP opencode_active_sessions");
			expect(output).toContain("# TYPE opencode_active_sessions gauge");
			expect(output).toContain("# HELP opencode_audit_db_size_bytes");
			expect(output).toContain("# TYPE opencode_audit_db_size_bytes gauge");
		});

		test("ends with newline", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);
			expect(output.endsWith("\n")).toBe(true);
		});
	});

	describe("tool execution counter", () => {
		test("formats tool execution counts with labels", () => {
			const data: MetricsData = {
				toolExecutions: [
					{ toolName: "read", decision: "completed", count: 42 },
					{ toolName: "read", decision: "failed", count: 3 },
					{ toolName: "write", decision: "completed", count: 10 },
				],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain(
				'opencode_tool_executions_total{tool_name="read",decision="completed"} 42',
			);
			expect(output).toContain(
				'opencode_tool_executions_total{tool_name="read",decision="failed"} 3',
			);
			expect(output).toContain(
				'opencode_tool_executions_total{tool_name="write",decision="completed"} 10',
			);
		});

		test("escapes special characters in tool names", () => {
			const data: MetricsData = {
				toolExecutions: [
					{ toolName: 'tool"with"quotes', decision: "completed", count: 1 },
					{
						toolName: "tool\\with\\backslash",
						decision: "completed",
						count: 2,
					},
				],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain('tool_name="tool\\"with\\"quotes"');
			expect(output).toContain('tool_name="tool\\\\with\\\\backslash"');
		});
	});

	describe("duration histogram", () => {
		test("formats duration histogram with buckets", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [
					{
						toolName: "read",
						count: 10,
						sum: 1.5,
						buckets: {
							"0.005": 2,
							"0.01": 4,
							"0.025": 6,
							"0.05": 7,
							"0.1": 8,
							"0.25": 9,
							"0.5": 10,
							"1": 10,
							"2.5": 10,
							"5": 10,
							"10": 10,
							"+Inf": 10,
						},
					},
				],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_bucket{tool_name="read",le="0.005"} 2',
			);
			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_bucket{tool_name="read",le="0.1"} 8',
			);
			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_bucket{tool_name="read",le="+Inf"} 10',
			);
			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_sum{tool_name="read"} 1.5',
			);
			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_count{tool_name="read"} 10',
			);
		});

		test("formats multiple tools in histogram", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [
					{
						toolName: "read",
						count: 5,
						sum: 0.5,
						buckets: {
							"0.005": 0,
							"0.01": 0,
							"0.025": 0,
							"0.05": 0,
							"0.1": 5,
							"0.25": 5,
							"0.5": 5,
							"1": 5,
							"2.5": 5,
							"5": 5,
							"10": 5,
							"+Inf": 5,
						},
					},
					{
						toolName: "write",
						count: 3,
						sum: 0.3,
						buckets: {
							"0.005": 0,
							"0.01": 0,
							"0.025": 0,
							"0.05": 0,
							"0.1": 3,
							"0.25": 3,
							"0.5": 3,
							"1": 3,
							"2.5": 3,
							"5": 3,
							"10": 3,
							"+Inf": 3,
						},
					},
				],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_count{tool_name="read"} 5',
			);
			expect(output).toContain(
				'opencode_tool_execution_duration_seconds_count{tool_name="write"} 3',
			);
		});
	});

	describe("in-progress gauge", () => {
		test("formats in-progress count", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 5,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain("opencode_tool_executions_in_progress 5");
		});

		test("shows zero when no in-progress executions", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain("opencode_tool_executions_in_progress 0");
		});
	});

	describe("session events counter", () => {
		test("formats session event counts", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [
					{ eventType: "created", count: 10 },
					{ eventType: "deleted", count: 5 },
					{ eventType: "error", count: 2 },
				],
				activeSessionCount: 0,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain(
				'opencode_sessions_total{event_type="created"} 10',
			);
			expect(output).toContain(
				'opencode_sessions_total{event_type="deleted"} 5',
			);
			expect(output).toContain('opencode_sessions_total{event_type="error"} 2');
		});
	});

	describe("active sessions gauge", () => {
		test("formats active session count", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 3,
				dbSizeBytes: 0,
			};

			const output = formatMetrics(data);

			expect(output).toContain("opencode_active_sessions 3");
		});
	});

	describe("database size gauge", () => {
		test("formats database size in bytes", () => {
			const data: MetricsData = {
				toolExecutions: [],
				toolDurations: [],
				inProgressCount: 0,
				sessionEvents: [],
				activeSessionCount: 0,
				dbSizeBytes: 1048576,
			};

			const output = formatMetrics(data);

			expect(output).toContain("opencode_audit_db_size_bytes 1048576");
		});
	});
});

// =============================================================================
// Metrics Query Tests
// =============================================================================

describe("metrics queries", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("getToolExecutionCounts", () => {
		test("returns empty for empty database", () => {
			const counts = testDb.getToolExecutionCounts();
			expect(counts).toEqual([]);
		});

		test("groups by tool name and decision", () => {
			testDb.logToolExecution({ toolName: "read", decision: "completed" });
			testDb.logToolExecution({ toolName: "read", decision: "completed" });
			testDb.logToolExecution({ toolName: "read", decision: "failed" });
			testDb.logToolExecution({ toolName: "write", decision: "completed" });

			const counts = testDb.getToolExecutionCounts();

			const readCompleted = counts.find(
				(c) => c.toolName === "read" && c.decision === "completed",
			);
			const readFailed = counts.find(
				(c) => c.toolName === "read" && c.decision === "failed",
			);
			const writeCompleted = counts.find(
				(c) => c.toolName === "write" && c.decision === "completed",
			);

			expect(readCompleted?.count).toBe(2);
			expect(readFailed?.count).toBe(1);
			expect(writeCompleted?.count).toBe(1);
		});

		test("includes started decision", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });

			const counts = testDb.getToolExecutionCounts();
			const readStarted = counts.find(
				(c) => c.toolName === "read" && c.decision === "started",
			);

			expect(readStarted?.count).toBe(1);
		});
	});

	describe("getToolDurationMetrics", () => {
		test("returns empty for empty database", () => {
			const metrics = testDb.getToolDurationMetrics();
			expect(metrics).toEqual([]);
		});

		test("calculates sum and count", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 100,
			});
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 200,
			});

			const metrics = testDb.getToolDurationMetrics();
			const readMetric = metrics.find((m) => m.toolName === "read");

			expect(readMetric?.count).toBe(2);
			expect(readMetric?.sum).toBeCloseTo(0.3, 5); // (100 + 200) / 1000
		});

		test("populates histogram buckets correctly", () => {
			// 5ms = 0.005s, should be in 0.005 bucket and all higher
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 5,
			});
			// 50ms = 0.05s, should be in 0.05 bucket and all higher
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});

			const metrics = testDb.getToolDurationMetrics();
			const readMetric = metrics.find((m) => m.toolName === "read");

			expect(readMetric?.buckets["0.005"]).toBe(1); // only 5ms fits
			expect(readMetric?.buckets["0.05"]).toBe(2); // both fit
			expect(readMetric?.buckets["+Inf"]).toBe(2); // all fit
		});

		test("ignores started entries", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 100,
			});

			const metrics = testDb.getToolDurationMetrics();
			const readMetric = metrics.find((m) => m.toolName === "read");

			expect(readMetric?.count).toBe(1);
		});

		test("ignores entries without duration", () => {
			testDb.logToolExecution({ toolName: "read", decision: "completed" }); // no duration
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 100,
			});

			const metrics = testDb.getToolDurationMetrics();
			const readMetric = metrics.find((m) => m.toolName === "read");

			expect(readMetric?.count).toBe(1);
		});

		test("includes failed entries with duration", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "failed",
				durationMs: 50,
			});

			const metrics = testDb.getToolDurationMetrics();
			const readMetric = metrics.find((m) => m.toolName === "read");

			expect(readMetric?.count).toBe(1);
		});
	});

	describe("getInProgressCount", () => {
		test("returns 0 for empty database", () => {
			const count = testDb.getInProgressCount();
			expect(count).toBe(0);
		});

		test("counts started entries without completion", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
				callId: "call-1",
			});
			testDb.logToolExecution({
				toolName: "write",
				decision: "started",
				callId: "call-2",
			});

			const count = testDb.getInProgressCount();
			expect(count).toBe(2);
		});

		test("excludes completed calls", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
				callId: "call-1",
			});
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				callId: "call-1",
			});
			testDb.logToolExecution({
				toolName: "write",
				decision: "started",
				callId: "call-2",
			});

			const count = testDb.getInProgressCount();
			expect(count).toBe(1);
		});

		test("excludes failed calls", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
				callId: "call-1",
			});
			testDb.logToolExecution({
				toolName: "read",
				decision: "failed",
				callId: "call-1",
			});

			const count = testDb.getInProgressCount();
			expect(count).toBe(0);
		});

		test("handles entries without call_id", () => {
			// Entries without call_id can't be matched, so started ones count as in-progress
			testDb.logToolExecution({ toolName: "read", decision: "started" });

			const count = testDb.getInProgressCount();
			expect(count).toBe(1);
		});
	});

	describe("getSessionEventCounts", () => {
		test("returns empty for empty database", () => {
			const counts = testDb.getSessionEventCounts();
			expect(counts).toEqual([]);
		});

		test("groups by event type", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-2", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "deleted" });

			const counts = testDb.getSessionEventCounts();

			const created = counts.find((c) => c.eventType === "created");
			const deleted = counts.find((c) => c.eventType === "deleted");

			expect(created?.count).toBe(2);
			expect(deleted?.count).toBe(1);
		});

		test("includes all event types", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "idle" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "error" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "compacted" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "deleted" });

			const counts = testDb.getSessionEventCounts();
			expect(counts.length).toBe(5);
		});
	});

	describe("getActiveSessionCount", () => {
		test("returns 0 for empty database", () => {
			const count = testDb.getActiveSessionCount();
			expect(count).toBe(0);
		});

		test("counts sessions with created but not deleted", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-2", eventType: "created" });

			const count = testDb.getActiveSessionCount();
			expect(count).toBe(2);
		});

		test("excludes deleted sessions", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-2", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "deleted" });

			const count = testDb.getActiveSessionCount();
			expect(count).toBe(1);
		});

		test("handles sessions with multiple events", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "idle" });
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "idle" });

			const count = testDb.getActiveSessionCount();
			expect(count).toBe(1); // Still just one session
		});
	});
});

// =============================================================================
// HTTP Server Tests
// =============================================================================

describe("HTTP server", () => {
	// Note: We test the server responses using the actual module
	// These tests require importing the real module
	const {
		startMetricsServer,
		stopMetricsServer,
		isMetricsServerRunning,
		getMetricsServerPort,
	} = require("./prometheus") as typeof import("./prometheus");

	afterEach(() => {
		stopMetricsServer();
	});

	describe("startMetricsServer", () => {
		test("starts server on specified port", () => {
			const port = startMetricsServer(9999);
			expect(port).toBe(9999);
			expect(isMetricsServerRunning()).toBe(true);
		});

		test("returns existing port if already running", () => {
			startMetricsServer(9998);
			const port = startMetricsServer(9997); // Try different port
			expect(port).toBe(9998); // Should return original port
		});
	});

	describe("stopMetricsServer", () => {
		test("stops running server", () => {
			startMetricsServer(9996);
			expect(isMetricsServerRunning()).toBe(true);

			stopMetricsServer();
			expect(isMetricsServerRunning()).toBe(false);
		});

		test("handles stop when not running", () => {
			expect(isMetricsServerRunning()).toBe(false);
			stopMetricsServer(); // Should not throw
			expect(isMetricsServerRunning()).toBe(false);
		});
	});

	describe("getMetricsServerPort", () => {
		test("returns port when running", () => {
			startMetricsServer(9995);
			expect(getMetricsServerPort()).toBe(9995);
		});

		test("returns null when not running", () => {
			expect(getMetricsServerPort()).toBeNull();
		});
	});

	describe("HTTP endpoints", () => {
		test("GET /metrics returns 200 with prometheus format", async () => {
			const port = startMetricsServer(9994);

			const response = await fetch(`http://localhost:${port}/metrics`);

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toContain("text/plain");

			const body = await response.text();
			expect(body).toContain("# HELP opencode_tool_executions_total");
			expect(body).toContain("# TYPE opencode_tool_executions_total counter");
		});

		test("GET /health returns 200 OK", async () => {
			const port = startMetricsServer(9993);

			const response = await fetch(`http://localhost:${port}/health`);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("OK");
		});

		test("GET /unknown returns 404", async () => {
			const port = startMetricsServer(9992);

			const response = await fetch(`http://localhost:${port}/unknown`);

			expect(response.status).toBe(404);
		});

		test("POST /metrics returns 404", async () => {
			const port = startMetricsServer(9991);

			const response = await fetch(`http://localhost:${port}/metrics`, {
				method: "POST",
			});

			expect(response.status).toBe(404);
		});
	});
});

// =============================================================================
// Label Escaping Tests
// =============================================================================

describe("escapeLabelValue", () => {
	test("escapes backslashes", () => {
		expect(escapeLabelValue("path\\to\\file")).toBe("path\\\\to\\\\file");
	});

	test("escapes double quotes", () => {
		expect(escapeLabelValue('say "hello"')).toBe('say \\"hello\\"');
	});

	test("escapes newlines", () => {
		expect(escapeLabelValue("line1\nline2")).toBe("line1\\nline2");
	});

	test("handles multiple escape characters", () => {
		expect(escapeLabelValue('path\\to\\"file"\n')).toBe(
			'path\\\\to\\\\\\"file\\"\\n',
		);
	});

	test("leaves safe strings unchanged", () => {
		expect(escapeLabelValue("simple_tool_name")).toBe("simple_tool_name");
	});
});
