import { tool } from "@opencode-ai/plugin";
import { getToolStats } from "../db";
import { parseOptionalDate } from "../lib";

export const audit_stats = tool({
	description:
		"Get overall tool execution statistics from the audit trail. Optional params: since (ISO timestamp), before (ISO timestamp), session_id",
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
	},
	async execute(args) {
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
});
