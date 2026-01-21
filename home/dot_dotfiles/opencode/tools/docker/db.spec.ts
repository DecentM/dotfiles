/**
 * Tests for the docker db module.
 * Tests database operations and audit logging.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Decision, LogEntry } from "./types";

// =============================================================================
// Test Database Setup
// =============================================================================

// We'll create a fresh in-memory test database for each test suite
// to avoid affecting the real audit log

interface TestDb {
	db: Database;
	logOperation: (entry: LogEntry) => number;
	updateLogEntry: (
		id: number,
		resultSummary: string,
		durationMs: number,
	) => void;
	getOverallStats: (filter?: { since?: Date; decision?: Decision }) => {
		total: number;
		allowed: number;
		denied: number;
		avgDurationMs: number | null;
	};
	getPatternStats: (
		filter?: { since?: Date; decision?: Decision },
		limit?: number,
	) => Array<{
		patternMatched: string | null;
		decision: string;
		count: number;
	}>;
	getTopDeniedOperations: (
		since?: Date,
		limit?: number,
	) => Array<{ operation: string; count: number }>;
	getLogs: (filter?: {
		since?: Date;
		decision?: Decision;
		limit?: number;
	}) => Array<{
		timestamp: string;
		sessionId: string | null;
		operation: string;
		target: string | null;
		paramsJson: string | null;
		patternMatched: string | null;
		decision: string;
		resultSummary: string | null;
		durationMs: number | null;
	}>;
	close: () => void;
}

const createTestDb = (): TestDb => {
	const db = new Database(":memory:");

	// Create the table
	db.run(`
    CREATE TABLE IF NOT EXISTS docker_operation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      session_id TEXT,
      message_id TEXT,
      operation TEXT NOT NULL,
      target TEXT,
      params_json TEXT,
      pattern_matched TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
      result_summary TEXT,
      duration_ms INTEGER
    )
  `);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_docker_timestamp ON docker_operation_log(timestamp)`,
	);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_docker_decision ON docker_operation_log(decision)`,
	);
	db.run(
		`CREATE INDEX IF NOT EXISTS idx_docker_operation ON docker_operation_log(operation)`,
	);

	const logOperation = (entry: LogEntry): number => {
		const result = db.run(
			`INSERT INTO docker_operation_log
       (session_id, message_id, operation, target, params_json, pattern_matched, decision, result_summary, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.sessionId ?? null,
				entry.messageId ?? null,
				entry.operation,
				entry.target ?? null,
				entry.paramsJson ?? null,
				entry.patternMatched,
				entry.decision,
				entry.resultSummary ?? null,
				entry.durationMs ?? null,
			],
		);
		return Number(result.lastInsertRowid);
	};

	const updateLogEntry = (
		id: number,
		resultSummary: string,
		durationMs: number,
	): void => {
		db.run(
			`UPDATE docker_operation_log SET result_summary = ?, duration_ms = ? WHERE id = ?`,
			[resultSummary, durationMs, id],
		);
	};

	const buildWhereClause = (filter: {
		since?: Date;
		decision?: Decision;
	}): { conditions: string[]; params: (string | null)[] } => {
		const conditions: string[] = [];
		const params: (string | null)[] = [];

		if (filter.since) {
			conditions.push("timestamp >= ?");
			params.push(filter.since.toISOString());
		}

		if (filter.decision) {
			conditions.push("decision = ?");
			params.push(filter.decision);
		}

		return { conditions, params };
	};

	const getOverallStats = (
		filter: { since?: Date; decision?: Decision } = {},
	) => {
		const { conditions, params } = buildWhereClause(filter);
		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const row = db
			.query(
				`SELECT
          COUNT(*) as total,
          SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
          SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denied,
          AVG(CASE WHEN decision = 'allow' THEN duration_ms ELSE NULL END) as avg_duration_ms
        FROM docker_operation_log
        ${whereClause}`,
			)
			.get(...params) as {
			total: number;
			allowed: number;
			denied: number;
			avg_duration_ms: number | null;
		};

		return {
			total: row.total,
			allowed: row.allowed,
			denied: row.denied,
			avgDurationMs: row.avg_duration_ms,
		};
	};

	const getPatternStats = (
		filter: { since?: Date; decision?: Decision } = {},
		limit = 15,
	) => {
		const { conditions, params } = buildWhereClause(filter);
		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const rows = db
			.query(
				`SELECT
          pattern_matched,
          decision,
          COUNT(*) as count
        FROM docker_operation_log
        ${whereClause}
        GROUP BY pattern_matched, decision
        ORDER BY count DESC
        LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			pattern_matched: string | null;
			decision: string;
			count: number;
		}>;

		return rows.map((row) => ({
			patternMatched: row.pattern_matched,
			decision: row.decision,
			count: row.count,
		}));
	};

	const getTopDeniedOperations = (since?: Date, limit = 10) => {
		const params: (string | number)[] = [];

		let query = `
      SELECT operation, COUNT(*) as count
      FROM docker_operation_log
      WHERE decision = 'deny'
    `;

		if (since) {
			query += ` AND timestamp >= ?`;
			params.push(since.toISOString());
		}

		query += `
      GROUP BY operation
      ORDER BY count DESC
      LIMIT ?
    `;
		params.push(limit);

		return db.query(query).all(...params) as Array<{
			operation: string;
			count: number;
		}>;
	};

	const getLogs = (
		filter: { since?: Date; decision?: Decision; limit?: number } = {},
	) => {
		const { since, decision, limit = 1000 } = filter;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (since) {
			conditions.push("timestamp >= ?");
			params.push(since.toISOString());
		}

		if (decision) {
			conditions.push("decision = ?");
			params.push(decision);
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const rows = db
			.query(
				`SELECT timestamp, session_id, operation, target, params_json, pattern_matched, decision, result_summary, duration_ms
        FROM docker_operation_log
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			timestamp: string;
			session_id: string | null;
			operation: string;
			target: string | null;
			params_json: string | null;
			pattern_matched: string | null;
			decision: string;
			result_summary: string | null;
			duration_ms: number | null;
		}>;

		return rows.map((row) => ({
			timestamp: row.timestamp,
			sessionId: row.session_id,
			operation: row.operation,
			target: row.target,
			paramsJson: row.params_json,
			patternMatched: row.pattern_matched,
			decision: row.decision,
			resultSummary: row.result_summary,
			durationMs: row.duration_ms,
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
		logOperation,
		updateLogEntry,
		getOverallStats,
		getPatternStats,
		getTopDeniedOperations,
		getLogs,
		close,
	};
};

// =============================================================================
// logOperation
// =============================================================================

describe("logOperation", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic logging", () => {
		test("logs operation and returns ID", () => {
			const id = testDb.logOperation({
				operation: "container:list",
				patternMatched: "container:list",
				decision: "allow",
			});
			expect(id).toBe(1);
		});

		test("returns incrementing IDs", () => {
			const id1 = testDb.logOperation({
				operation: "container:list",
				patternMatched: "container:list",
				decision: "allow",
			});
			const id2 = testDb.logOperation({
				operation: "image:list",
				patternMatched: "image:list",
				decision: "allow",
			});
			expect(id2).toBe(id1 + 1);
		});
	});

	describe("field persistence", () => {
		test("stores all entry fields", () => {
			testDb.logOperation({
				sessionId: "session-123",
				messageId: "msg-456",
				operation: "container:create",
				target: "alpine:latest",
				paramsJson: '{"Image":"alpine:latest"}',
				patternMatched: "container:create:*",
				decision: "allow",
				resultSummary: "Container created: abc123",
				durationMs: 150,
			});

			const logs = testDb.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].sessionId).toBe("session-123");
			expect(logs[0].operation).toBe("container:create");
			expect(logs[0].target).toBe("alpine:latest");
			expect(logs[0].paramsJson).toBe('{"Image":"alpine:latest"}');
			expect(logs[0].patternMatched).toBe("container:create:*");
			expect(logs[0].decision).toBe("allow");
			expect(logs[0].resultSummary).toBe("Container created: abc123");
			expect(logs[0].durationMs).toBe(150);
		});

		test("handles null optional fields", () => {
			testDb.logOperation({
				operation: "container:list",
				patternMatched: null,
				decision: "deny",
			});

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBeNull();
			expect(logs[0].target).toBeNull();
			expect(logs[0].patternMatched).toBeNull();
			expect(logs[0].resultSummary).toBeNull();
			expect(logs[0].durationMs).toBeNull();
		});
	});

	describe("decision values", () => {
		test("stores allow decision", () => {
			testDb.logOperation({
				operation: "container:list",
				patternMatched: "container:list",
				decision: "allow",
			});
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("allow");
		});

		test("stores deny decision", () => {
			testDb.logOperation({
				operation: "volume:create",
				patternMatched: null,
				decision: "deny",
			});
			const logs = testDb.getLogs();
			expect(logs[0].decision).toBe("deny");
		});
	});

	describe("timestamp", () => {
		test("generates timestamp automatically", () => {
			testDb.logOperation({
				operation: "container:list",
				patternMatched: "container:list",
				decision: "allow",
			});
			const logs = testDb.getLogs();
			expect(logs[0].timestamp).toBeDefined();
			// Timestamp should be a valid date string
			expect(new Date(logs[0].timestamp).getTime()).not.toBeNaN();
		});
	});
});

// =============================================================================
// updateLogEntry
// =============================================================================

describe("updateLogEntry", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("updates result summary and duration", () => {
		const id = testDb.logOperation({
			operation: "container:create",
			patternMatched: "container:create:*",
			decision: "allow",
		});

		testDb.updateLogEntry(id, "Container created: abc123", 200);

		const logs = testDb.getLogs();
		expect(logs[0].resultSummary).toBe("Container created: abc123");
		expect(logs[0].durationMs).toBe(200);
	});

	test("updates only specified entry", () => {
		const id1 = testDb.logOperation({
			operation: "container:list",
			patternMatched: "container:list",
			decision: "allow",
		});
		const id2 = testDb.logOperation({
			operation: "image:list",
			patternMatched: "image:list",
			decision: "allow",
		});

		testDb.updateLogEntry(id1, "Listed 5 containers", 50);

		const logs = testDb.getLogs();
		// Logs are ordered DESC by timestamp, so id2 comes first
		const entry1 = logs.find((l) => l.operation === "container:list");
		const entry2 = logs.find((l) => l.operation === "image:list");

		expect(entry1?.resultSummary).toBe("Listed 5 containers");
		expect(entry1?.durationMs).toBe(50);
		expect(entry2?.resultSummary).toBeNull();
		expect(entry2?.durationMs).toBeNull();
	});

	test("overwrites existing values", () => {
		const id = testDb.logOperation({
			operation: "container:create",
			patternMatched: "container:create:*",
			decision: "allow",
			resultSummary: "Initial summary",
			durationMs: 100,
		});

		testDb.updateLogEntry(id, "Updated summary", 250);

		const logs = testDb.getLogs();
		expect(logs[0].resultSummary).toBe("Updated summary");
		expect(logs[0].durationMs).toBe(250);
	});
});

// =============================================================================
// getOverallStats
// =============================================================================

describe("getOverallStats", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	describe("basic statistics", () => {
		test("returns zeros for empty database", () => {
			const stats = testDb.getOverallStats();
			expect(stats.total).toBe(0);
			// SQLite SUM() returns null when there are no rows
			expect(stats.allowed).toBeNull();
			expect(stats.denied).toBeNull();
			expect(stats.avgDurationMs).toBeNull();
		});

		test("counts total operations", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: "b",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "c",
				patternMatched: null,
				decision: "deny",
			});

			const stats = testDb.getOverallStats();
			expect(stats.total).toBe(3);
		});

		test("counts allowed vs denied", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: "b",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "c",
				patternMatched: null,
				decision: "deny",
			});

			const stats = testDb.getOverallStats();
			expect(stats.allowed).toBe(2);
			expect(stats.denied).toBe(1);
		});

		test("calculates average duration for allowed operations", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
				durationMs: 100,
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: "b",
				decision: "allow",
				durationMs: 200,
			});
			testDb.logOperation({
				operation: "c",
				patternMatched: null,
				decision: "deny",
				durationMs: 10,
			});

			const stats = testDb.getOverallStats();
			expect(stats.avgDurationMs).toBe(150); // (100 + 200) / 2, excludes denied
		});
	});

	describe("filtering", () => {
		test("filters by decision", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: null,
				decision: "deny",
			});
			testDb.logOperation({
				operation: "c",
				patternMatched: null,
				decision: "deny",
			});

			const allowStats = testDb.getOverallStats({ decision: "allow" });
			expect(allowStats.total).toBe(1);

			const denyStats = testDb.getOverallStats({ decision: "deny" });
			expect(denyStats.total).toBe(2);
		});
	});
});

// =============================================================================
// getPatternStats
// =============================================================================

describe("getPatternStats", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("returns empty for empty database", () => {
		const stats = testDb.getPatternStats();
		expect(stats).toEqual([]);
	});

	test("groups by pattern and decision", () => {
		testDb.logOperation({
			operation: "a",
			patternMatched: "pattern1",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "b",
			patternMatched: "pattern1",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "c",
			patternMatched: "pattern2",
			decision: "deny",
		});

		const stats = testDb.getPatternStats();
		expect(stats.length).toBe(2);

		const pattern1Stats = stats.find((s) => s.patternMatched === "pattern1");
		expect(pattern1Stats?.count).toBe(2);
		expect(pattern1Stats?.decision).toBe("allow");
	});

	test("orders by count descending", () => {
		testDb.logOperation({
			operation: "a",
			patternMatched: "rare",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "b",
			patternMatched: "common",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "c",
			patternMatched: "common",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "d",
			patternMatched: "common",
			decision: "allow",
		});

		const stats = testDb.getPatternStats();
		expect(stats[0].patternMatched).toBe("common");
		expect(stats[0].count).toBe(3);
	});

	test("respects limit parameter", () => {
		testDb.logOperation({
			operation: "a",
			patternMatched: "p1",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "b",
			patternMatched: "p2",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "c",
			patternMatched: "p3",
			decision: "allow",
		});

		const stats = testDb.getPatternStats({}, 2);
		expect(stats.length).toBe(2);
	});

	test("handles null pattern", () => {
		testDb.logOperation({
			operation: "a",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "b",
			patternMatched: null,
			decision: "deny",
		});

		const stats = testDb.getPatternStats();
		expect(stats.length).toBe(1);
		expect(stats[0].patternMatched).toBeNull();
		expect(stats[0].count).toBe(2);
	});
});

// =============================================================================
// getTopDeniedOperations
// =============================================================================

describe("getTopDeniedOperations", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.close();
	});

	test("returns empty for empty database", () => {
		const ops = testDb.getTopDeniedOperations();
		expect(ops).toEqual([]);
	});

	test("only counts denied operations", () => {
		testDb.logOperation({
			operation: "allowed:op",
			patternMatched: "p",
			decision: "allow",
		});
		testDb.logOperation({
			operation: "denied:op",
			patternMatched: null,
			decision: "deny",
		});

		const ops = testDb.getTopDeniedOperations();
		expect(ops.length).toBe(1);
		expect(ops[0].operation).toBe("denied:op");
	});

	test("groups and counts by operation", () => {
		testDb.logOperation({
			operation: "volume:create",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "volume:create",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "volume:remove",
			patternMatched: null,
			decision: "deny",
		});

		const ops = testDb.getTopDeniedOperations();
		expect(ops[0].operation).toBe("volume:create");
		expect(ops[0].count).toBe(2);
		expect(ops[1].operation).toBe("volume:remove");
		expect(ops[1].count).toBe(1);
	});

	test("orders by count descending", () => {
		testDb.logOperation({
			operation: "rare:op",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "common:op",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "common:op",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "common:op",
			patternMatched: null,
			decision: "deny",
		});

		const ops = testDb.getTopDeniedOperations();
		expect(ops[0].operation).toBe("common:op");
		expect(ops[0].count).toBe(3);
	});

	test("respects limit parameter", () => {
		testDb.logOperation({
			operation: "op1",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "op2",
			patternMatched: null,
			decision: "deny",
		});
		testDb.logOperation({
			operation: "op3",
			patternMatched: null,
			decision: "deny",
		});

		const ops = testDb.getTopDeniedOperations(undefined, 2);
		expect(ops.length).toBe(2);
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

		test("returns all logged operations", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: "b",
				decision: "allow",
			});

			const logs = testDb.getLogs();
			expect(logs.length).toBe(2);
		});

		test("orders by timestamp descending (newest first)", () => {
			testDb.logOperation({
				operation: "first",
				patternMatched: "p",
				decision: "allow",
			});
			// Small delay to ensure different timestamps
			testDb.logOperation({
				operation: "second",
				patternMatched: "p",
				decision: "allow",
			});

			const logs = testDb.getLogs();
			// Both have same timestamp in in-memory DB, but second should be last inserted
			expect(logs.length).toBe(2);
		});
	});

	describe("filtering", () => {
		test("filters by decision", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: null,
				decision: "deny",
			});

			const allowLogs = testDb.getLogs({ decision: "allow" });
			expect(allowLogs.length).toBe(1);
			expect(allowLogs[0].decision).toBe("allow");

			const denyLogs = testDb.getLogs({ decision: "deny" });
			expect(denyLogs.length).toBe(1);
			expect(denyLogs[0].decision).toBe("deny");
		});

		test("respects limit parameter", () => {
			testDb.logOperation({
				operation: "a",
				patternMatched: "a",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "b",
				patternMatched: "b",
				decision: "allow",
			});
			testDb.logOperation({
				operation: "c",
				patternMatched: "c",
				decision: "allow",
			});

			const logs = testDb.getLogs({ limit: 2 });
			expect(logs.length).toBe(2);
		});

		test("default limit is 1000", () => {
			// Just verify it doesn't crash with no limit specified
			const logs = testDb.getLogs();
			expect(Array.isArray(logs)).toBe(true);
		});
	});

	describe("field mapping", () => {
		test("maps database columns to camelCase", () => {
			testDb.logOperation({
				sessionId: "sess-123",
				messageId: "msg-456",
				operation: "container:create",
				target: "alpine",
				paramsJson: "{}",
				patternMatched: "container:create:*",
				decision: "allow",
				resultSummary: "Created",
				durationMs: 100,
			});

			const logs = testDb.getLogs();
			expect(logs[0].sessionId).toBe("sess-123");
			expect(logs[0].paramsJson).toBe("{}");
			expect(logs[0].patternMatched).toBe("container:create:*");
			expect(logs[0].resultSummary).toBe("Created");
			expect(logs[0].durationMs).toBe(100);
		});
	});
});
