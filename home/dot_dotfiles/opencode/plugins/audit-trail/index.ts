import type { Plugin } from "@opencode-ai/plugin";
import * as listeners from "./listeners";
import * as tools from "./tools/index";

const AuditTrailPlugin: Plugin = async (ctx) => {
	return {
		tool: tools,
		'tool.execute.before': listeners.toolExecuteBeforeListener(ctx.client),
		'tool.execute.after': listeners.toolExecuteAfterListener(ctx.client),
	};
};

export default AuditTrailPlugin;
