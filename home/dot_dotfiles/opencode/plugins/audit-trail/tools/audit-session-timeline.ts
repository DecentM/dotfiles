import { tool } from "@opencode-ai/plugin";
import { getSessionTimeline } from "../db";

export const audit_session_timeline = tool({
	description:
		"Get timeline of all events for a specific session. Required param: session_id",
	args: {
		session_id: tool.schema
			.string()
			.describe("The session ID to get timeline for (required)"),
	},
	async execute(args) {
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
});
