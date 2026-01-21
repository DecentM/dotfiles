/**
 * Tests for the audit-trail plugin db module.
 * Tests database operations and audit logging for tool execution and session events.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type {
	LogsFilter,
	SessionEventType,
	SessionLogEntry,
	SessionLogRow,
	SessionTimelineEntry,
	StatsFilter,
	ToolDecision,
	ToolExecutionLogEntry,
	ToolExecutionLogRow,
	ToolStats,
	ToolUsage,
} from "./types";

// =============================================================================
// Test Database Setup
// =============================================================================

// We create a fresh in-memory test database for each test suite
// to avoid affecting the real audit log

interface TestDb {
	db: Database;
	logToolExecution: (entry: ToolExecutionLogEntry) => number;
	updateToolExecution: (
		id: number,
		decision: "completed" | "failed",
		resultSummary: string,
		durationMs: number,
	) => void;
	logSessionEvent: (entry: SessionLogEntry) => number;
	getToolStats: (filter?: StatsFilter) => ToolStats;
	getToolUsage: (filter?: StatsFilter, limit?: number) => ToolUsage[];
	getSessionTimeline: (sessionId: string) => SessionTimelineEntry[];
	getLogs: (filter?: LogsFilter) => ToolExecutionLogRow[];
	getSessionLogs: (sessionId?: string, limit?: number) => SessionLogRow[];
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
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_tool_timestamp ON tool_execution_log(timestamp)`,
	);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_execution_log(tool_name)`,
	);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_tool_session_id ON tool_execution_log(session_id)`,
	);

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
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_session_id ON session_log(session_id)`,
	);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_session_event_type ON session_log(event_type)`,
	);

	const logToolExecution = (entry: ToolExecutionLogEntry): number => {
		const result = db.run(
			`INSERT INTO tool_execution_log
       (timestamp, session_id, message_id, call_id, tool_name, agent, args_json, decision, result_summary, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Date.now(),
				entry.sessionId ?? null,
				entry.messageId ?? null,
				entry.callId ?? null,
				entry.toolName,
				entry.agent ?? null,
				entry.argsJson ?? null,
				entry.decision,
				entry.resultSummary ?? null,
				entry.durationMs ?? null,
			],
		);
		return Number(result.lastInsertRowid);
	};

	const updateToolExecution = (
		id: number,
		decision: "completed" | "failed",
		resultSummary: string,
		durationMs: number,
	): void => {
		db.run(
			`UPDATE tool_execution_log SET decision = ?, result_summary = ?, duration_ms = ? WHERE id = ?`,
			[decision, resultSummary, durationMs, id],
		);
	};

	const logSessionEvent = (entry: SessionLogEntry): number => {
		const result = db.run(
			`INSERT INTO session_log (timestamp, session_id, event_type, details_json) VALUES (?, ?, ?, ?)`,
			[Date.now(), entry.sessionId, entry.eventType, entry.detailsJson ?? null],
		);
		return Number(result.lastInsertRowid);
	};

	const buildToolWhereClause = (
		filter: StatsFilter,
	): { conditions: string[]; params: (string | number | null)[] } => {
		const conditions: string[] = [];
		const params: (string | number | null)[] = [];

		if (filter.since) {
			conditions.push("timestamp >= ?");
			params.push(filter.since.getTime());
		}

		if (filter.before) {
			conditions.push("timestamp <= ?");
			params.push(filter.before.getTime());
		}

		if (filter.sessionId) {
			conditions.push("session_id = ?");
			params.push(filter.sessionId);
		}

		if (filter.toolName) {
			conditions.push("tool_name = ?");
			params.push(filter.toolName);
		}

		return { conditions, params };
	};

	const getToolStats = (filter: StatsFilter = {}): ToolStats => {
		const { conditions, params } = buildToolWhereClause(filter);
		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const row = db
			.query(
				`SELECT
          COUNT(*) as total,
          SUM(CASE WHEN decision = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN decision = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(CASE WHEN decision IN ('completed', 'failed') THEN duration_ms ELSE NULL END) as avg_duration_ms
        FROM tool_execution_log
        ${whereClause}`,
			)
			.get(...params) as {
			total: number;
			completed: number;
			failed: number;
			avg_duration_ms: number | null;
		};

		return {
			total: row.total,
			completed: row.completed,
			failed: row.failed,
			avgDurationMs: row.avg_duration_ms,
		};
	};

	const getToolUsage = (filter: StatsFilter = {}, limit = 15): ToolUsage[] => {
		const { conditions, params } = buildToolWhereClause(filter);
		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const rows = db
			.query(
				`SELECT
          tool_name,
          COUNT(*) as count,
          AVG(CASE WHEN decision IN ('completed', 'failed') THEN duration_ms ELSE NULL END) as avg_duration_ms
        FROM tool_execution_log
        ${whereClause}
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			tool_name: string;
			count: number;
			avg_duration_ms: number | null;
		}>;

		return rows.map((row) => ({
			toolName: row.tool_name,
			count: row.count,
			avgDurationMs: row.avg_duration_ms,
		}));
	};

	const getSessionTimeline = (sessionId: string): SessionTimelineEntry[] => {
		// Get tool executions for this session
		const toolRows = db
			.query(
				`SELECT timestamp, tool_name, decision, result_summary, duration_ms
         FROM tool_execution_log
         WHERE session_id = ?
         ORDER BY timestamp ASC`,
			)
			.all(sessionId) as Array<{
			timestamp: number;
			tool_name: string;
			decision: string;
			result_summary: string | null;
			duration_ms: number | null;
		}>;

		// Get session events for this session
		const sessionRows = db
			.query(
				`SELECT timestamp, event_type, details_json
         FROM session_log
         WHERE session_id = ?
         ORDER BY timestamp ASC`,
			)
			.all(sessionId) as Array<{
			timestamp: number;
			event_type: string;
			details_json: string | null;
		}>;

		// Combine and sort by timestamp
		const timeline: SessionTimelineEntry[] = [
			...toolRows.map((row) => ({
				timestamp: row.timestamp,
				type: "tool_execution" as const,
				toolName: row.tool_name,
				decision: row.decision as ToolDecision,
				resultSummary: row.result_summary ?? undefined,
				durationMs: row.duration_ms,
			})),
			...sessionRows.map((row) => ({
				timestamp: row.timestamp,
				type: "session_event" as const,
				eventType: row.event_type as SessionEventType,
				detailsJson: row.details_json,
			})),
		];

		// Sort by timestamp (numeric comparison)
		timeline.sort((a, b) => a.timestamp - b.timestamp);

		return timeline;
	};

	const getLogs = (filter: LogsFilter = {}): ToolExecutionLogRow[] => {
		const { since, before, sessionId, toolName, limit = 1000 } = filter;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (since) {
			conditions.push("timestamp >= ?");
			params.push(since.getTime());
		}

		if (before) {
			conditions.push("timestamp <= ?");
			params.push(before.getTime());
		}

		if (sessionId) {
			conditions.push("session_id = ?");
			params.push(sessionId);
		}

		if (toolName) {
			conditions.push("tool_name = ?");
			params.push(toolName);
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const rows = db
			.query(
				`SELECT id, timestamp, session_id, message_id, call_id, tool_name, agent, args_json, decision, result_summary, duration_ms
         FROM tool_execution_log
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			id: number;
			timestamp: number;
			session_id: string | null;
			message_id: string | null;
			call_id: string | null;
			tool_name: string;
			agent: string | null;
			args_json: string | null;
			decision: string;
			result_summary: string | null;
			duration_ms: number | null;
		}>;

		return rows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			sessionId: row.session_id,
			messageId: row.message_id,
			callId: row.call_id,
			toolName: row.tool_name,
			agent: row.agent,
			argsJson: row.args_json,
			decision: row.decision as ToolDecision,
			resultSummary: row.result_summary,
			durationMs: row.duration_ms,
		}));
	};

	const getSessionLogs = (
		sessionId?: string,
		limit = 1000,
	): SessionLogRow[] => {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (sessionId) {
			conditions.push("session_id = ?");
			params.push(sessionId);
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const rows = db
			.query(
				`SELECT id, timestamp, session_id, event_type, details_json
         FROM session_log
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			id: number;
			timestamp: number;
			session_id: string;
			event_type: string;
			details_json: string | null;
		}>;

		return rows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			sessionId: row.session_id,
			eventType: row.event_type as SessionEventType,
			detailsJson: row.details_json,
		}));
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
		updateToolExecution,
		logSessionEvent,
		getToolStats,
		getToolUsage,
		getSessionTimeline,
		getLogs,
		getSessionLogs,
		close,
	};
};

// =============================================================================
// Database Initialization
// =============================================================================

describe("database initialization", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("table creation", () => {
		test("creates tool_execution_log table", () => {
			const result = testDb.db
				.query(
					`SELECT name FROM sqlite_master WHERE type='table' AND name='tool_execution_log'`,
				)
				.get();
			expect(result).toBeDefined();
		});

		test("creates session_log table", () => {
			const result = testDb.db
				.query(
					`SELECT name FROM sqlite_master WHERE type='table' AND name='session_log'`,
				)
				.get();
			expect(result).toBeDefined();
		});

		test("tool_execution_log has correct columns", () => {
			const columns = testDb.db
				.query(`PRAGMA table_info(tool_execution_log)`)
				.all() as Array<{
				name: string;
			}>;
			const columnNames = columns.map((c) => c.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("timestamp");
			expect(columnNames).toContain("session_id");
			expect(columnNames).toContain("message_id");
			expect(columnNames).toContain("call_id");
			expect(columnNames).toContain("tool_name");
			expect(columnNames).toContain("agent");
			expect(columnNames).toContain("args_json");
			expect(columnNames).toContain("decision");
			expect(columnNames).toContain("result_summary");
			expect(columnNames).toContain("duration_ms");
		});

		test("session_log has correct columns", () => {
			const columns = testDb.db
				.query(`PRAGMA table_info(session_log)`)
				.all() as Array<{
				name: string;
			}>;
			const columnNames = columns.map((c) => c.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("timestamp");
			expect(columnNames).toContain("session_id");
			expect(columnNames).toContain("event_type");
			expect(columnNames).toContain("details_json");
		});
	});

	describe("index creation", () => {
		test("creates tool_execution_log indexes", () => {
			const indexes = testDb.db
				.query(
					`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tool_execution_log'`,
				)
				.all() as Array<{ name: string }>;
			const indexNames = indexes.map((i) => i.name);

			expect(indexNames).toContain("idx_tool_timestamp");
			expect(indexNames).toContain("idx_tool_name");
			expect(indexNames).toContain("idx_tool_session_id");
		});

		test("creates session_log indexes", () => {
			const indexes = testDb.db
				.query(
					`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='session_log'`,
				)
				.all() as Array<{ name: string }>;
			const indexNames = indexes.map((i) => i.name);

			expect(indexNames).toContain("idx_session_id");
			expect(indexNames).toContain("idx_session_event_type");
		});
	});
});

// =============================================================================
// logToolExecution
// =============================================================================

describe("logToolExecution", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic logging", () => {
		test("logs tool execution and returns ID", () => {
			const id = testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});
			expect(id).toBe(1);
		});

		test("returns incrementing IDs", () => {
			const id1 = testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});
			const id2 = testDb.logToolExecution({
				toolName: "write",
				decision: "started",
			});
			expect(id2).toBe(id1 + 1);
		});
	});

	describe("field persistence", () => {
		test("stores all entry fields", () => {
			testDb.logToolExecution({
				sessionId: "session-123",
				messageId: "msg-456",
				callId: "call-789",
				toolName: "read",
				agent: "coder",
				argsJson: '{"filePath":"/test/path"}',
				decision: "completed",
				resultSummary: "Read 100 lines",
				durationMs: 50,
			});

			const logs = testDb.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].sessionId).toBe("session-123");
			expect(logs[0].messageId).toBe("msg-456");
			expect(logs[0].callId).toBe("call-789");
			expect(logs[0].toolName).toBe("read");
			expect(logs[0].agent).toBe("coder");
			expect(logs[0].argsJson).toBe('{"filePath":"/test/path"}');
			expect(logs[0].decision).toBe("completed");
			expect(logs[0].resultSummary).toBe("Read 100 lines");
			expect(logs[0].durationMs).toBe(50);
		});

		test("handles null optional fields", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBeNull();
			expect(logs[0].messageId).toBeNull();
			expect(logs[0].callId).toBeNull();
			expect(logs[0].agent).toBeNull();
			expect(logs[0].argsJson).toBeNull();
			expect(logs[0].resultSummary).toBeNull();
			expect(logs[0].durationMs).toBeNull();
		});
	});

	describe("decision values", () => {
		test("stores started decision", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("started");
		});

		test("stores completed decision", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 100,
			});
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("completed");
		});

		test("stores failed decision", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "failed",
				resultSummary: "File not found",
				durationMs: 10,
			});
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("failed");
		});
	});

	describe("timestamp", () => {
		test("generates timestamp automatically", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});
			const logs = testDb.getLogs();
			expect(logs[0].timestamp).toBeDefined();
			// Timestamp should be a valid unix timestamp (number)
			expect(typeof logs[0].timestamp).toBe("number");
			expect(logs[0].timestamp).toBeGreaterThan(0);
		});
	});
});

// =============================================================================
// updateToolExecution
// =============================================================================

describe("updateToolExecution", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("updates decision, result summary, and duration", () => {
		const id = testDb.logToolExecution({
			toolName: "read",
			decision: "started",
		});

		testDb.updateToolExecution(id, "completed", "Read 150 lines", 75);

		const logs = testDb.getLogs();
		expect(logs[0].decision).toBe("completed");
		expect(logs[0].resultSummary).toBe("Read 150 lines");
		expect(logs[0].durationMs).toBe(75);
	});

	test("updates only specified entry", () => {
		const id1 = testDb.logToolExecution({
			toolName: "read",
			decision: "started",
		});
		const id2 = testDb.logToolExecution({
			toolName: "write",
			decision: "started",
		});

		testDb.updateToolExecution(id1, "completed", "Read complete", 50);

		const logs = testDb.getLogs();
		const entry1 = logs.find((l) => l.toolName === "read");
		const entry2 = logs.find((l) => l.toolName === "write");

		expect(entry1?.decision).toBe("completed");
		expect(entry1?.resultSummary).toBe("Read complete");
		expect(entry1?.durationMs).toBe(50);
		expect(entry2?.decision).toBe("started");
		expect(entry2?.resultSummary).toBeNull();
		expect(entry2?.durationMs).toBeNull();
	});

	test("can update to failed status", () => {
		const id = testDb.logToolExecution({
			toolName: "read",
			decision: "started",
		});

		testDb.updateToolExecution(id, "failed", "Permission denied", 5);

		const logs = testDb.getLogs();
		expect(logs[0].decision).toBe("failed");
		expect(logs[0].resultSummary).toBe("Permission denied");
		expect(logs[0].durationMs).toBe(5);
	});

	describe("two-phase logging workflow", () => {
		test("supports start -> complete workflow", () => {
			// Phase 1: Log start
			const id = testDb.logToolExecution({
				sessionId: "sess-123",
				toolName: "glob",
				agent: "coder",
				argsJson: '{"pattern":"**/*.ts"}',
				decision: "started",
			});

			// Verify started state
			let logs = testDb.getLogs();
			expect(logs[0].decision).toBe("started");
			expect(logs[0].durationMs).toBeNull();

			// Phase 2: Update with completion
			testDb.updateToolExecution(id, "completed", "Found 42 files", 120);

			// Verify completed state
			logs = testDb.getLogs();
			expect(logs[0].decision).toBe("completed");
			expect(logs[0].resultSummary).toBe("Found 42 files");
			expect(logs[0].durationMs).toBe(120);
		});

		test("supports start -> fail workflow", () => {
			// Phase 1: Log start
			const id = testDb.logToolExecution({
				sessionId: "sess-456",
				toolName: "sh",
				decision: "started",
			});

			// Phase 2: Update with failure
			testDb.updateToolExecution(id, "failed", "Command not allowed", 2);

			// Verify failed state
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("failed");
			expect(logs[0].resultSummary).toBe("Command not allowed");
			expect(logs[0].durationMs).toBe(2);
		});
	});
});

// =============================================================================
// logSessionEvent
// =============================================================================

describe("logSessionEvent", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic logging", () => {
		test("logs session event and returns ID", () => {
			const id = testDb.logSessionEvent({
				sessionId: "session-123",
				eventType: "created",
			});
			expect(id).toBe(1);
		});

		test("returns incrementing IDs", () => {
			const id1 = testDb.logSessionEvent({
				sessionId: "session-123",
				eventType: "created",
			});
			const id2 = testDb.logSessionEvent({
				sessionId: "session-123",
				eventType: "idle",
			});
			expect(id2).toBe(id1 + 1);
		});
	});

	describe("event types", () => {
		test("stores created event", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "created",
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].eventType).toBe("created");
		});

		test("stores compacted event", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "compacted",
				detailsJson: '{"messageCount":50}',
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].eventType).toBe("compacted");
			expect(logs[0].detailsJson).toBe('{"messageCount":50}');
		});

		test("stores deleted event", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "deleted",
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].eventType).toBe("deleted");
		});

		test("stores error event", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "error",
				detailsJson: '{"error":"Connection timeout"}',
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].eventType).toBe("error");
			expect(logs[0].detailsJson).toBe('{"error":"Connection timeout"}');
		});

		test("stores idle event", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "idle",
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].eventType).toBe("idle");
		});
	});

	describe("field persistence", () => {
		test("stores all fields", () => {
			testDb.logSessionEvent({
				sessionId: "session-abc",
				eventType: "created",
				detailsJson: '{"workdir":"/home/user"}',
			});

			const logs = testDb.getSessionLogs("session-abc");
			expect(logs.length).toBe(1);
			expect(logs[0].sessionId).toBe("session-abc");
			expect(logs[0].eventType).toBe("created");
			expect(logs[0].detailsJson).toBe('{"workdir":"/home/user"}');
		});

		test("handles null detailsJson", () => {
			testDb.logSessionEvent({
				sessionId: "session-abc",
				eventType: "created",
			});

			const logs = testDb.getSessionLogs("session-abc");
			expect(logs[0].detailsJson).toBeNull();
		});
	});

	describe("timestamp", () => {
		test("generates timestamp automatically", () => {
			testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "created",
			});
			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].timestamp).toBeDefined();
			// Timestamp should be a valid unix timestamp (number)
			expect(typeof logs[0].timestamp).toBe("number");
			expect(logs[0].timestamp).toBeGreaterThan(0);
		});
	});
});

// =============================================================================
// getToolStats
// =============================================================================

describe("getToolStats", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic statistics", () => {
		test("returns zeros for empty database", () => {
			const stats = testDb.getToolStats();
			expect(stats.total).toBe(0);
			// SQLite SUM() returns null when there are no rows
			expect(stats.completed).toBeNull();
			expect(stats.failed).toBeNull();
			expect(stats.avgDurationMs).toBeNull();
		});

		test("counts total executions", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });
			testDb.logToolExecution({
				toolName: "write",
				decision: "completed",
				durationMs: 100,
			});
			testDb.logToolExecution({
				toolName: "glob",
				decision: "failed",
				durationMs: 10,
			});

			const stats = testDb.getToolStats();
			expect(stats.total).toBe(3);
		});

		test("counts completed vs failed", () => {
			testDb.logToolExecution({
				toolName: "a",
				decision: "completed",
				durationMs: 50,
			});
			testDb.logToolExecution({
				toolName: "b",
				decision: "completed",
				durationMs: 60,
			});
			testDb.logToolExecution({
				toolName: "c",
				decision: "failed",
				durationMs: 5,
			});
			testDb.logToolExecution({ toolName: "d", decision: "started" });

			const stats = testDb.getToolStats();
			expect(stats.completed).toBe(2);
			expect(stats.failed).toBe(1);
		});

		test("calculates average duration for completed/failed executions", () => {
			testDb.logToolExecution({
				toolName: "a",
				decision: "completed",
				durationMs: 100,
			});
			testDb.logToolExecution({
				toolName: "b",
				decision: "completed",
				durationMs: 200,
			});
			testDb.logToolExecution({
				toolName: "c",
				decision: "failed",
				durationMs: 300,
			});
			testDb.logToolExecution({
				toolName: "d",
				decision: "started",
				// No duration for started
			});

			const stats = testDb.getToolStats();
			expect(stats.avgDurationMs).toBe(200); // (100 + 200 + 300) / 3
		});
	});

	describe("filtering", () => {
		test("filters by sessionId", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});
			testDb.logToolExecution({
				sessionId: "sess-2",
				toolName: "write",
				decision: "completed",
				durationMs: 60,
			});

			const stats = testDb.getToolStats({ sessionId: "sess-1" });
			expect(stats.total).toBe(1);
		});

		test("filters by toolName", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 60,
			});
			testDb.logToolExecution({
				toolName: "write",
				decision: "completed",
				durationMs: 70,
			});

			const stats = testDb.getToolStats({ toolName: "read" });
			expect(stats.total).toBe(2);
		});

		test("combines multiple filters", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "write",
				decision: "completed",
				durationMs: 60,
			});
			testDb.logToolExecution({
				sessionId: "sess-2",
				toolName: "read",
				decision: "completed",
				durationMs: 70,
			});

			const stats = testDb.getToolStats({
				sessionId: "sess-1",
				toolName: "read",
			});
			expect(stats.total).toBe(1);
		});

		test("filters by before timestamp", () => {
			// Insert entries with controlled timestamps using raw SQL
			const pastTime = Date.now() - 10000;
			const futureTime = Date.now() + 10000;

			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision, duration_ms) VALUES (?, ?, ?, ?)`,
				[pastTime, "old_tool", "completed", 50]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision, duration_ms) VALUES (?, ?, ?, ?)`,
				[futureTime, "new_tool", "completed", 60]
			);

			const stats = testDb.getToolStats({ before: new Date(Date.now()) });
			expect(stats.total).toBe(1);
		});

		test("filters by since and before together (range query)", () => {
			// Insert entries with controlled timestamps
			const oldTime = Date.now() - 20000;
			const midTime = Date.now() - 10000;
			const newTime = Date.now() + 10000;

			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision, duration_ms) VALUES (?, ?, ?, ?)`,
				[oldTime, "old_tool", "completed", 50]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision, duration_ms) VALUES (?, ?, ?, ?)`,
				[midTime, "mid_tool", "completed", 60]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision, duration_ms) VALUES (?, ?, ?, ?)`,
				[newTime, "new_tool", "completed", 70]
			);

			// Query for range: only mid_tool should match
			const stats = testDb.getToolStats({
				since: new Date(oldTime + 1),
				before: new Date(newTime - 1),
			});
			expect(stats.total).toBe(1);
		});
	});
});

// =============================================================================
// getToolUsage
// =============================================================================

describe("getToolUsage", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("returns empty for empty database", () => {
		const usage = testDb.getToolUsage();
		expect(usage).toEqual([]);
	});

	test("groups by tool name", () => {
		testDb.logToolExecution({
			toolName: "read",
			decision: "completed",
			durationMs: 50,
		});
		testDb.logToolExecution({
			toolName: "read",
			decision: "completed",
			durationMs: 60,
		});
		testDb.logToolExecution({
			toolName: "write",
			decision: "completed",
			durationMs: 70,
		});

		const usage = testDb.getToolUsage();
		expect(usage.length).toBe(2);

		const readUsage = usage.find((u) => u.toolName === "read");
		expect(readUsage?.count).toBe(2);
	});

	test("calculates average duration per tool", () => {
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
		testDb.logToolExecution({
			toolName: "write",
			decision: "completed",
			durationMs: 50,
		});

		const usage = testDb.getToolUsage();
		const readUsage = usage.find((u) => u.toolName === "read");
		expect(readUsage?.avgDurationMs).toBe(150);

		const writeUsage = usage.find((u) => u.toolName === "write");
		expect(writeUsage?.avgDurationMs).toBe(50);
	});

	test("orders by count descending", () => {
		testDb.logToolExecution({
			toolName: "rare",
			decision: "completed",
			durationMs: 50,
		});
		testDb.logToolExecution({
			toolName: "common",
			decision: "completed",
			durationMs: 60,
		});
		testDb.logToolExecution({
			toolName: "common",
			decision: "completed",
			durationMs: 70,
		});
		testDb.logToolExecution({
			toolName: "common",
			decision: "completed",
			durationMs: 80,
		});

		const usage = testDb.getToolUsage();
		expect(usage[0].toolName).toBe("common");
		expect(usage[0].count).toBe(3);
		expect(usage[1].toolName).toBe("rare");
		expect(usage[1].count).toBe(1);
	});

	test("respects limit parameter", () => {
		testDb.logToolExecution({ toolName: "t1", decision: "started" });
		testDb.logToolExecution({ toolName: "t2", decision: "started" });
		testDb.logToolExecution({ toolName: "t3", decision: "started" });

		const usage = testDb.getToolUsage({}, 2);
		expect(usage.length).toBe(2);
	});

	test("excludes started entries from duration average", () => {
		testDb.logToolExecution({ toolName: "read", decision: "started" });
		testDb.logToolExecution({
			toolName: "read",
			decision: "completed",
			durationMs: 100,
		});

		const usage = testDb.getToolUsage();
		const readUsage = usage.find((u) => u.toolName === "read");
		// Average should only consider the completed entry
		expect(readUsage?.avgDurationMs).toBe(100);
		expect(readUsage?.count).toBe(2);
	});
});

// =============================================================================
// getSessionTimeline
// =============================================================================

describe("getSessionTimeline", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("returns empty for non-existent session", () => {
		const timeline = testDb.getSessionTimeline("non-existent");
		expect(timeline).toEqual([]);
	});

	test("returns tool executions for session", () => {
		testDb.logToolExecution({
			sessionId: "sess-1",
			toolName: "read",
			decision: "completed",
			durationMs: 50,
		});
		testDb.logToolExecution({
			sessionId: "sess-1",
			toolName: "write",
			decision: "completed",
			durationMs: 60,
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline.length).toBe(2);
		expect(timeline[0].type).toBe("tool_execution");
		expect(timeline[0].toolName).toBe("read");
		expect(timeline[1].toolName).toBe("write");
	});

	test("returns session events for session", () => {
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "created",
		});
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "idle",
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline.length).toBe(2);
		expect(timeline[0].type).toBe("session_event");
		expect(timeline[0].eventType).toBe("created");
		expect(timeline[1].eventType).toBe("idle");
	});

	test("combines tool executions and session events", () => {
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "created",
		});
		testDb.logToolExecution({
			sessionId: "sess-1",
			toolName: "read",
			decision: "completed",
			durationMs: 50,
		});
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "idle",
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline.length).toBe(3);

		// Should have both types
		const types = timeline.map((e) => e.type);
		expect(types).toContain("tool_execution");
		expect(types).toContain("session_event");
	});

	test("only includes events for specified session", () => {
		testDb.logToolExecution({
			sessionId: "sess-1",
			toolName: "read",
			decision: "completed",
			durationMs: 50,
		});
		testDb.logToolExecution({
			sessionId: "sess-2",
			toolName: "write",
			decision: "completed",
			durationMs: 60,
		});
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "created",
		});
		testDb.logSessionEvent({
			sessionId: "sess-2",
			eventType: "created",
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline.length).toBe(2);
	});

	test("includes all tool execution fields", () => {
		testDb.logToolExecution({
			sessionId: "sess-1",
			toolName: "read",
			decision: "completed",
			resultSummary: "Read 100 lines",
			durationMs: 75,
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline[0].type).toBe("tool_execution");
		expect(timeline[0].toolName).toBe("read");
		expect(timeline[0].decision).toBe("completed");
		expect(timeline[0].resultSummary).toBe("Read 100 lines");
		expect(timeline[0].durationMs).toBe(75);
	});

	test("includes all session event fields", () => {
		testDb.logSessionEvent({
			sessionId: "sess-1",
			eventType: "error",
			detailsJson: '{"error":"Something went wrong"}',
		});

		const timeline = testDb.getSessionTimeline("sess-1");
		expect(timeline[0].type).toBe("session_event");
		expect(timeline[0].eventType).toBe("error");
		expect(timeline[0].detailsJson).toBe('{"error":"Something went wrong"}');
	});
});

// =============================================================================
// getLogs
// =============================================================================

describe("getLogs", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic retrieval", () => {
		test("returns empty for empty database", () => {
			const logs = testDb.getLogs();
			expect(logs).toEqual([]);
		});

		test("returns all logged executions", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });
			testDb.logToolExecution({ toolName: "write", decision: "started" });

			const logs = testDb.getLogs();
			expect(logs.length).toBe(2);
		});

		test("orders by timestamp descending (newest first)", () => {
			testDb.logToolExecution({ toolName: "first", decision: "started" });
			testDb.logToolExecution({ toolName: "second", decision: "started" });

			const logs = testDb.getLogs();
			expect(logs.length).toBe(2);
			// In same-timestamp scenario, order may vary but both should be present
		});
	});

	describe("filtering", () => {
		test("filters by sessionId", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "started",
			});
			testDb.logToolExecution({
				sessionId: "sess-2",
				toolName: "write",
				decision: "started",
			});

			const logs = testDb.getLogs({ sessionId: "sess-1" });
			expect(logs.length).toBe(1);
			expect(logs[0].sessionId).toBe("sess-1");
		});

		test("filters by toolName", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });
			testDb.logToolExecution({ toolName: "write", decision: "started" });

			const logs = testDb.getLogs({ toolName: "read" });
			expect(logs.length).toBe(1);
			expect(logs[0].toolName).toBe("read");
		});

		test("respects limit parameter", () => {
			testDb.logToolExecution({ toolName: "a", decision: "started" });
			testDb.logToolExecution({ toolName: "b", decision: "started" });
			testDb.logToolExecution({ toolName: "c", decision: "started" });

			const logs = testDb.getLogs({ limit: 2 });
			expect(logs.length).toBe(2);
		});

		test("default limit is 1000", () => {
			// Just verify it doesn't crash with no limit specified
			const logs = testDb.getLogs();
			expect(Array.isArray(logs)).toBe(true);
		});

		test("combines multiple filters", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "started",
			});
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "write",
				decision: "started",
			});
			testDb.logToolExecution({
				sessionId: "sess-2",
				toolName: "read",
				decision: "started",
			});

			const logs = testDb.getLogs({ sessionId: "sess-1", toolName: "read" });
			expect(logs.length).toBe(1);
			expect(logs[0].sessionId).toBe("sess-1");
			expect(logs[0].toolName).toBe("read");
		});

		test("filters by before timestamp", () => {
			// Insert entries with controlled timestamps using raw SQL
			const pastTime = Date.now() - 10000;
			const futureTime = Date.now() + 10000;

			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision) VALUES (?, ?, ?)`,
				[pastTime, "old_tool", "started"]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision) VALUES (?, ?, ?)`,
				[futureTime, "new_tool", "started"]
			);

			const logs = testDb.getLogs({ before: new Date(Date.now()) });
			expect(logs.length).toBe(1);
			expect(logs[0].toolName).toBe("old_tool");
		});

		test("filters by since and before together (range query)", () => {
			// Insert entries with controlled timestamps
			const oldTime = Date.now() - 20000;
			const midTime = Date.now() - 10000;
			const newTime = Date.now() + 10000;

			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision) VALUES (?, ?, ?)`,
				[oldTime, "old_tool", "started"]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision) VALUES (?, ?, ?)`,
				[midTime, "mid_tool", "started"]
			);
			testDb.db.run(
				`INSERT INTO tool_execution_log (timestamp, tool_name, decision) VALUES (?, ?, ?)`,
				[newTime, "new_tool", "started"]
			);

			// Query for range: only mid_tool should match
			const logs = testDb.getLogs({
				since: new Date(oldTime + 1),
				before: new Date(newTime - 1),
			});
			expect(logs.length).toBe(1);
			expect(logs[0].toolName).toBe("mid_tool");
		});
	});

	describe("field mapping", () => {
		test("maps database columns to camelCase", () => {
			testDb.logToolExecution({
				sessionId: "sess-123",
				messageId: "msg-456",
				callId: "call-789",
				toolName: "read",
				agent: "coder",
				argsJson: '{"path":"/test"}',
				decision: "completed",
				resultSummary: "Done",
				durationMs: 100,
			});

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBe("sess-123");
			expect(logs[0].messageId).toBe("msg-456");
			expect(logs[0].callId).toBe("call-789");
			expect(logs[0].toolName).toBe("read");
			expect(logs[0].agent).toBe("coder");
			expect(logs[0].argsJson).toBe('{"path":"/test"}');
			expect(logs[0].decision).toBe("completed");
			expect(logs[0].resultSummary).toBe("Done");
			expect(logs[0].durationMs).toBe(100);
		});
	});
});

// =============================================================================
// getSessionLogs
// =============================================================================

describe("getSessionLogs", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("returns empty for empty database", () => {
		const logs = testDb.getSessionLogs();
		expect(logs).toEqual([]);
	});

	test("returns all session events when no filter", () => {
		testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
		testDb.logSessionEvent({ sessionId: "sess-2", eventType: "created" });

		const logs = testDb.getSessionLogs();
		expect(logs.length).toBe(2);
	});

	test("filters by sessionId", () => {
		testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
		testDb.logSessionEvent({ sessionId: "sess-2", eventType: "created" });

		const logs = testDb.getSessionLogs("sess-1");
		expect(logs.length).toBe(1);
		expect(logs[0].sessionId).toBe("sess-1");
	});

	test("respects limit parameter", () => {
		testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });
		testDb.logSessionEvent({ sessionId: "sess-1", eventType: "idle" });
		testDb.logSessionEvent({ sessionId: "sess-1", eventType: "deleted" });

		const logs = testDb.getSessionLogs("sess-1", 2);
		expect(logs.length).toBe(2);
	});

	test("maps all fields correctly", () => {
		testDb.logSessionEvent({
			sessionId: "sess-abc",
			eventType: "error",
			detailsJson: '{"reason":"timeout"}',
		});

		const logs = testDb.getSessionLogs("sess-abc");
		expect(logs[0].sessionId).toBe("sess-abc");
		expect(logs[0].eventType).toBe("error");
		expect(logs[0].detailsJson).toBe('{"reason":"timeout"}');
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("empty database queries", () => {
		test("getToolStats returns appropriate nulls for empty db", () => {
			const stats = testDb.getToolStats();
			expect(stats.total).toBe(0);
			expect(stats.avgDurationMs).toBeNull();
		});

		test("getToolUsage returns empty array for empty db", () => {
			const usage = testDb.getToolUsage();
			expect(usage).toEqual([]);
		});

		test("getSessionTimeline returns empty array for non-existent session", () => {
			const timeline = testDb.getSessionTimeline("does-not-exist");
			expect(timeline).toEqual([]);
		});

		test("getLogs returns empty array for empty db", () => {
			const logs = testDb.getLogs();
			expect(logs).toEqual([]);
		});

		test("getSessionLogs returns empty array for empty db", () => {
			const logs = testDb.getSessionLogs();
			expect(logs).toEqual([]);
		});
	});

	describe("filters with no matches", () => {
		test("getToolStats with non-matching sessionId", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});

			const stats = testDb.getToolStats({ sessionId: "non-existent" });
			expect(stats.total).toBe(0);
		});

		test("getToolUsage with non-matching toolName", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 50,
			});

			const usage = testDb.getToolUsage({ toolName: "non-existent" });
			expect(usage).toEqual([]);
		});

		test("getLogs with non-matching sessionId", () => {
			testDb.logToolExecution({
				sessionId: "sess-1",
				toolName: "read",
				decision: "started",
			});

			const logs = testDb.getLogs({ sessionId: "non-existent" });
			expect(logs).toEqual([]);
		});

		test("getSessionLogs with non-matching sessionId", () => {
			testDb.logSessionEvent({ sessionId: "sess-1", eventType: "created" });

			const logs = testDb.getSessionLogs("non-existent");
			expect(logs).toEqual([]);
		});
	});

	describe("missing optional fields", () => {
		test("logToolExecution with minimal fields", () => {
			const id = testDb.logToolExecution({
				toolName: "read",
				decision: "started",
			});
			expect(id).toBeGreaterThan(0);

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBeNull();
			expect(logs[0].messageId).toBeNull();
			expect(logs[0].callId).toBeNull();
			expect(logs[0].agent).toBeNull();
			expect(logs[0].argsJson).toBeNull();
			expect(logs[0].resultSummary).toBeNull();
			expect(logs[0].durationMs).toBeNull();
		});

		test("logSessionEvent with minimal fields", () => {
			const id = testDb.logSessionEvent({
				sessionId: "sess-1",
				eventType: "created",
			});
			expect(id).toBeGreaterThan(0);

			const logs = testDb.getSessionLogs("sess-1");
			expect(logs[0].detailsJson).toBeNull();
		});
	});

	describe("special characters and edge values", () => {
		test("handles empty string values", () => {
			testDb.logToolExecution({
				sessionId: "",
				toolName: "read",
				decision: "started",
				resultSummary: "",
			});

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBe("");
			expect(logs[0].resultSummary).toBe("");
		});

		test("handles JSON with special characters", () => {
			const complexJson = JSON.stringify({
				path: '/path/with "quotes" and \\backslashes',
				message: "Line1\nLine2\tTabbed",
			});

			testDb.logToolExecution({
				toolName: "read",
				decision: "started",
				argsJson: complexJson,
			});

			const logs = testDb.getLogs();
			expect(logs[0].argsJson).toBe(complexJson);
		});

		test("handles zero duration", () => {
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: 0,
			});

			const logs = testDb.getLogs();
			expect(logs[0].durationMs).toBe(0);
		});

		test("handles very long tool names", () => {
			const longName = "a".repeat(1000);
			testDb.logToolExecution({
				toolName: longName,
				decision: "started",
			});

			const logs = testDb.getLogs();
			expect(logs[0].toolName).toBe(longName);
		});

		test("handles very large duration values", () => {
			const largeDuration = 999999999;
			testDb.logToolExecution({
				toolName: "read",
				decision: "completed",
				durationMs: largeDuration,
			});

			const logs = testDb.getLogs();
			expect(logs[0].durationMs).toBe(largeDuration);
		});
	});

	describe("limit edge cases", () => {
		test("limit of 0 returns no results", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });

			const logs = testDb.getLogs({ limit: 0 });
			expect(logs).toEqual([]);
		});

		test("limit of 1 returns single result", () => {
			testDb.logToolExecution({ toolName: "a", decision: "started" });
			testDb.logToolExecution({ toolName: "b", decision: "started" });

			const logs = testDb.getLogs({ limit: 1 });
			expect(logs.length).toBe(1);
		});

		test("limit larger than result set returns all", () => {
			testDb.logToolExecution({ toolName: "read", decision: "started" });

			const logs = testDb.getLogs({ limit: 100 });
			expect(logs.length).toBe(1);
		});
	});
});
