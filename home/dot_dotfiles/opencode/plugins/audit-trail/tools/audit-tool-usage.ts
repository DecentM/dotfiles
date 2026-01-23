import { tool } from "@opencode-ai/plugin";
import { getToolUsage } from "../db";
import { parseOptionalDate } from "../lib";

export const audit_tool_usage = tool({
	description:
		"Get tool usage breakdown from the audit trail. Optional params: since (ISO timestamp), before (ISO timestamp), limit (max results, default 15)",
	args: {
		since: tool.schema
			.string()
			.optional()
			.describe("ISO timestamp to filter from"),
		before: tool.schema
			.string()
			.optional()
			.describe("ISO timestamp to filter until"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of results (default 15)"),
	},
	async execute(args) {
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
});
