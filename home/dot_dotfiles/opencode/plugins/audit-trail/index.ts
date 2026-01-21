import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import { dbManager } from "./db";
import type { ToolExecutionLogEntry } from "./types";

const plugin: Plugin = async () => {
  return {
    event: async () => {},
    
    "tool.execute.before": async () => {},
    
    "tool.execute.after": async () => {},
    
    tool: {
      audit_test: tool({
        description: "Test tool with schema",
        args: {
          since: tool.schema.string().optional().describe("ISO timestamp"),
          limit: tool.schema.number().optional().describe("Max results"),
        },
        async execute(args) {
          return JSON.stringify({ since: args.since, limit: args.limit });
        },
      }),
    },
  };
};

export default plugin;

// =============================================================================
// Re-exports for External Use
// =============================================================================

export {
	dbManager,
	getLogs,
	getSessionLogs,
	getSessionTimeline,
	getToolStats,
	getToolUsage,
} from "./db";

export type {
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
