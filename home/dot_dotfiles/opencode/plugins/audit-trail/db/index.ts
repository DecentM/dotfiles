export type { DatabaseType } from "./data-source";
export { closeDataSource, getDataSource } from "./data-source";
export type {
	PermissionStatus,
	SessionEventType,
	ToolExecutionDecision,
} from "./entities";

export {
	ChatMessage,
	CommandExecution,
	PermissionEvent,
	SessionEvent,
	ToolExecution,
} from "./entities";
export {
	isDatabaseConfigured,
	memoryChatMessageStore,
	memoryCommandExecutionStore,
	memoryPermissionEventStore,
	memorySessionEventStore,
	memoryToolExecutionStore,
} from "./memory-store";
export type {
	ChatMessageRepository,
	CommandExecutionRepository,
	GetChatMessagesFilters,
	GetCommandExecutionsFilters,
	GetLogsFilters,
	GetPermissionEventsFilters,
	GetSessionLogsFilters,
	LogChatMessageData,
	LogCommandExecutionData,
	LogPermissionEventData,
	LogSessionEventData,
	LogToolExecutionData,
	PermissionEventRepository,
	SessionEventRepository,
	TimelineEntry,
	ToolExecutionRepository,
	ToolStats,
	ToolUsageEntry,
} from "./repositories";
export {
	getChatMessageRepository,
	getCommandExecutionRepository,
	getPermissionEventRepository,
	getSessionEventRepository,
	getToolExecutionRepository,
} from "./repositories";

// Export shared interface types from types.ts
export type {
	ChatMessageInput,
	CommandExecutionInput,
	IChatMessage,
	IChatMessageStore,
	ICommandExecution,
	ICommandExecutionStore,
	IPermissionEvent,
	IPermissionEventStore,
	ISessionEvent,
	ISessionEventStore,
	IToolExecution,
	IToolExecutionStore,
	PermissionEventInput,
	SessionEventInput,
	ToolExecutionInput,
} from "./types";

// Import store interface types for use in function signatures below
import type {
	IChatMessageStore,
	ICommandExecutionStore,
	IPermissionEventStore,
	ISessionEventStore,
	IToolExecutionStore,
} from "./types";

/**
 * Get the tool execution store, using memory store as fallback when DB is not configured.
 */
export const getToolExecutionStore = async (): Promise<IToolExecutionStore> => {
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
export const getSessionEventStore = async (): Promise<ISessionEventStore> => {
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

/**
 * Get the chat message store, using memory store as fallback when DB is not configured.
 */
export const getChatMessageStore = async (): Promise<IChatMessageStore> => {
	const {
		isDatabaseConfigured: isDbConfigured,
		memoryChatMessageStore: memStore,
	} = await import("./memory-store");

	if (!isDbConfigured()) {
		return memStore;
	}

	const { getChatMessageRepository: getRepo } = await import("./repositories");
	return getRepo();
};

/**
 * Get the permission event store, using memory store as fallback when DB is not configured.
 */
export const getPermissionEventStore =
	async (): Promise<IPermissionEventStore> => {
		const {
			isDatabaseConfigured: isDbConfigured,
			memoryPermissionEventStore: memStore,
		} = await import("./memory-store");

		if (!isDbConfigured()) {
			return memStore;
		}

		const { getPermissionEventRepository: getRepo } = await import(
			"./repositories"
		);
		return getRepo();
	};

/**
 * Get the command execution store, using memory store as fallback when DB is not configured.
 */
export const getCommandExecutionStore =
	async (): Promise<ICommandExecutionStore> => {
		const {
			isDatabaseConfigured: isDbConfigured,
			memoryCommandExecutionStore: memStore,
		} = await import("./memory-store");

		if (!isDbConfigured()) {
			return memStore;
		}

		const { getCommandExecutionRepository: getRepo } = await import(
			"./repositories"
		);
		return getRepo();
	};
