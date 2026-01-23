import { tool } from "@opencode-ai/plugin";
import { getLogs } from "../db";
import { parseOptionalDate } from "../lib";

export const audit_export_logs = tool({
	description:
		"Export audit logs with optional filters. Optional params: since (ISO timestamp), before (ISO timestamp), session_id, tool_name, limit (max results, default 1000)",
	args: {
		since: tool.schema
			.string()
			.optional()
			.describe("ISO timestamp to filter from"),
		before: tool.schema
			.string()
			.optional()
			.describe("ISO timestamp to filter until"),
		session_id: tool.schema
			.string()
			.optional()
			.describe("Filter by session ID"),
		tool_name: tool.schema.string().optional().describe("Filter by tool name"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of results (default 1000)"),
	},
	async execute(args) {
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
});
