export type { DatabaseType } from "./data-source";
export { closeDataSource, getDataSource } from "./data-source";
export type { SessionEventType, ToolExecutionDecision } from "./entities";

export { SessionEvent, ToolExecution } from "./entities";
export type { SessionEventStore, ToolExecutionStore } from "./memory-store";
export {
	isDatabaseConfigured,
	memorySessionEventStore,
	memoryToolExecutionStore,
} from "./memory-store";
export type {
	GetLogsFilters,
	GetSessionLogsFilters,
	LogSessionEventData,
	LogToolExecutionData,
	SessionEventRepository,
	TimelineEntry,
	ToolExecutionRepository,
	ToolStats,
	ToolUsageEntry,
} from "./repositories";
export {
	getSessionEventRepository,
	getToolExecutionRepository,
} from "./repositories";

/**
 * Get the tool execution store, using memory store as fallback when DB is not configured.
 */
export const getToolExecutionStore = async (): Promise<
	import("./memory-store").ToolExecutionStore
> => {
	const {
		isDatabaseConfigured: isDbConfigured,
		memoryToolExecutionStore: memStore,
	} = await import("./memory-store");

	if (!isDbConfigured()) {
		return memStore;
	}

	const { getToolExecutionRepository: getRepo } = await import(
		"./repositories"
	);
	return getRepo();
};

/**
 * Get the session event store, using memory store as fallback when DB is not configured.
 */
export const getSessionEventStore = async (): Promise<
	import("./memory-store").SessionEventStore
> => {
	const {
		isDatabaseConfigured: isDbConfigured,
		memorySessionEventStore: memStore,
	} = await import("./memory-store");

	if (!isDbConfigured()) {
		return memStore;
	}

	const { getSessionEventRepository: getRepo } = await import("./repositories");
	return getRepo();
};
