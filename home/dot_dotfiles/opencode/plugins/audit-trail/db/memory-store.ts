import type {
	ChatMessageInput,
	CommandExecutionInput,
	GetChatMessagesFilters,
	GetCommandExecutionsFilters,
	GetLogsFilters,
	GetPermissionEventsFilters,
	GetSessionLogsFilters,
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
	TimelineEntry,
	ToolExecutionInput,
	ToolStats,
	ToolUsageEntry,
} from "./types";

// Storage arrays with proper typing from shared interfaces
let toolExecutions: IToolExecution[] = [];
let sessionEvents: ISessionEvent[] = [];
let chatMessages: IChatMessage[] = [];
let permissionEvents: IPermissionEvent[] = [];
let commandExecutions: ICommandExecution[] = [];
let nextToolId = 1;
let nextSessionId = 1;
let nextChatMessageId = 1;
let nextPermissionEventId = 1;
let nextCommandExecutionId = 1;

// Tool Execution methods - implements IToolExecutionStore
export const memoryToolExecutionStore: IToolExecutionStore & {
	clear: () => void;
} = {
	logToolExecution: async (
		data: ToolExecutionInput,
	): Promise<IToolExecution | null> => {
		const entry: IToolExecution = {
			id: nextToolId++,
			timestamp: new Date(),
			sessionId: data.sessionId,
			messageId: data.messageId ?? null,
			callId: data.callId ?? null,
			toolName: data.toolName,
			agentId: data.agentId ?? null,
			arguments: data.arguments ?? null,
			decision: data.decision,
			resultSummary: data.resultSummary ?? null,
			durationMs: data.durationMs ?? null,
		};
		toolExecutions.push(entry);
		return entry;
	},

	getLogs: async (filters?: GetLogsFilters): Promise<IToolExecution[]> => {
		let results = [...toolExecutions];

		if (filters?.startDate) {
			results = results.filter((e) => e.timestamp >= filters.startDate!);
		}
		if (filters?.endDate) {
			results = results.filter((e) => e.timestamp <= filters.endDate!);
		}
		if (filters?.sessionId) {
			results = results.filter((e) => e.sessionId === filters.sessionId);
		}
		if (filters?.toolName) {
			results = results.filter((e) => e.toolName === filters.toolName);
		}

		results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		if (filters?.limit) {
			results = results.slice(0, filters.limit);
		}

		return results;
	},

	getToolStats: async (): Promise<ToolStats> => {
		const completedCount = toolExecutions.filter(
			(e) => e.decision === "completed",
		).length;
		const failedCount = toolExecutions.filter(
			(e) => e.decision === "failed",
		).length;
		const withDuration = toolExecutions.filter((e) => e.durationMs != null);
		const avgDurationMs =
			withDuration.length > 0
				? withDuration.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) /
					withDuration.length
				: null;

		return {
			totalExecutions: toolExecutions.length,
			completedCount,
			failedCount,
			avgDurationMs,
		};
	},

	getToolUsage: async (topN = 10): Promise<ToolUsageEntry[]> => {
		const byTool = new Map<
			string,
			{ count: number; totalDuration: number; durationCount: number }
		>();

		for (const exec of toolExecutions) {
			const existing = byTool.get(exec.toolName) ?? {
				count: 0,
				totalDuration: 0,
				durationCount: 0,
			};
			existing.count++;
			if (exec.durationMs != null) {
				existing.totalDuration += exec.durationMs;
				existing.durationCount++;
			}
			byTool.set(exec.toolName, existing);
		}

		return Array.from(byTool.entries())
			.map(([toolName, data]) => ({
				toolName,
				executionCount: data.count,
				avgDurationMs:
					data.durationCount > 0
						? data.totalDuration / data.durationCount
						: null,
			}))
			.sort((a, b) => b.executionCount - a.executionCount)
			.slice(0, topN);
	},

	clear: () => {
		toolExecutions = [];
		nextToolId = 1;
	},
};

// Session Event methods - implements ISessionEventStore
export const memorySessionEventStore: ISessionEventStore & {
	clear: () => void;
} = {
	logSessionEvent: async (
		data: SessionEventInput,
	): Promise<ISessionEvent | null> => {
		const entry: ISessionEvent = {
			id: nextSessionId++,
			timestamp: new Date(),
			sessionId: data.sessionId,
			eventType: data.eventType,
			details: data.details ?? null,
		};
		sessionEvents.push(entry);
		return entry;
	},

	getSessionLogs: async (
		filters?: GetSessionLogsFilters,
	): Promise<ISessionEvent[]> => {
		let results = [...sessionEvents];

		if (filters?.startDate) {
			results = results.filter((e) => e.timestamp >= filters.startDate!);
		}
		if (filters?.endDate) {
			results = results.filter((e) => e.timestamp <= filters.endDate!);
		}
		if (filters?.sessionId) {
			results = results.filter((e) => e.sessionId === filters.sessionId);
		}
		if (filters?.eventType) {
			results = results.filter((e) => e.eventType === filters.eventType);
		}

		results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		if (filters?.limit) {
			results = results.slice(0, filters.limit);
		}

		return results;
	},

	getSessionTimeline: async (sessionId: string): Promise<TimelineEntry[]> => {
		const toolEvents = toolExecutions
			.filter((e) => e.sessionId === sessionId)
			.map((e) => ({ timestamp: e.timestamp, type: "tool" as const, data: e }));

		const sessEvents = sessionEvents
			.filter((e) => e.sessionId === sessionId)
			.map((e) => ({
				timestamp: e.timestamp,
				type: "session" as const,
				data: e,
			}));

		return [...toolEvents, ...sessEvents].sort(
			(a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
		);
	},

	clear: () => {
		sessionEvents = [];
		nextSessionId = 1;
	},
};

// Chat Message methods - implements IChatMessageStore
export const memoryChatMessageStore: IChatMessageStore & { clear: () => void } =
	{
		logChatMessage: async (
			data: ChatMessageInput,
		): Promise<IChatMessage | null> => {
			const entry: IChatMessage = {
				id: nextChatMessageId++,
				timestamp: new Date(),
				sessionId: data.sessionId,
				messageId: data.messageId ?? null,
				agent: data.agent ?? null,
				providerId: data.providerId ?? null,
				modelId: data.modelId ?? null,
				variant: data.variant ?? null,
				messageContent: data.messageContent ?? null,
				partsJson: data.partsJson ?? null,
			};
			chatMessages.push(entry);
			return entry;
		},

		getChatMessages: async (
			filters?: GetChatMessagesFilters,
		): Promise<IChatMessage[]> => {
			let results = [...chatMessages];

			if (filters?.startDate) {
				results = results.filter((e) => e.timestamp >= filters.startDate!);
			}
			if (filters?.endDate) {
				results = results.filter((e) => e.timestamp <= filters.endDate!);
			}
			if (filters?.sessionId) {
				results = results.filter((e) => e.sessionId === filters.sessionId);
			}

			results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

			if (filters?.limit) {
				results = results.slice(0, filters.limit);
			}

			return results;
		},

		clear: () => {
			chatMessages = [];
			nextChatMessageId = 1;
		},
	};

// Permission Event methods - implements IPermissionEventStore
export const memoryPermissionEventStore: IPermissionEventStore & {
	clear: () => void;
} = {
	logPermissionEvent: async (
		data: PermissionEventInput,
	): Promise<IPermissionEvent | null> => {
		const entry: IPermissionEvent = {
			id: nextPermissionEventId++,
			timestamp: new Date(),
			sessionId: data.sessionId,
			permissionType: data.permissionType,
			resource: data.resource ?? null,
			status: data.status,
			detailsJson: data.detailsJson ?? null,
		};
		permissionEvents.push(entry);
		return entry;
	},

	getPermissionEvents: async (
		filters?: GetPermissionEventsFilters,
	): Promise<IPermissionEvent[]> => {
		let results = [...permissionEvents];

		if (filters?.startDate) {
			results = results.filter((e) => e.timestamp >= filters.startDate!);
		}
		if (filters?.endDate) {
			results = results.filter((e) => e.timestamp <= filters.endDate!);
		}
		if (filters?.sessionId) {
			results = results.filter((e) => e.sessionId === filters.sessionId);
		}
		if (filters?.status) {
			results = results.filter((e) => e.status === filters.status);
		}

		results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		if (filters?.limit) {
			results = results.slice(0, filters.limit);
		}

		return results;
	},

	clear: () => {
		permissionEvents = [];
		nextPermissionEventId = 1;
	},
};

// Command Execution methods - implements ICommandExecutionStore
export const memoryCommandExecutionStore: ICommandExecutionStore & {
	clear: () => void;
} = {
	logCommandExecution: async (
		data: CommandExecutionInput,
	): Promise<ICommandExecution | null> => {
		const entry: ICommandExecution = {
			id: nextCommandExecutionId++,
			timestamp: new Date(),
			sessionId: data.sessionId,
			command: data.command,
			arguments: data.arguments ?? null,
			partsJson: data.partsJson ?? null,
		};
		commandExecutions.push(entry);
		return entry;
	},

	getCommandExecutions: async (
		filters?: GetCommandExecutionsFilters,
	): Promise<ICommandExecution[]> => {
		let results = [...commandExecutions];

		if (filters?.startDate) {
			results = results.filter((e) => e.timestamp >= filters.startDate!);
		}
		if (filters?.endDate) {
			results = results.filter((e) => e.timestamp <= filters.endDate!);
		}
		if (filters?.sessionId) {
			results = results.filter((e) => e.sessionId === filters.sessionId);
		}
		if (filters?.command) {
			results = results.filter((e) => e.command === filters.command);
		}

		results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		if (filters?.limit) {
			results = results.slice(0, filters.limit);
		}

		return results;
	},

	clear: () => {
		commandExecutions = [];
		nextCommandExecutionId = 1;
	},
};

/**
 * Check if database is configured via environment variables.
 */
export const isDatabaseConfigured = (): boolean => {
	const host = process.env.AUDIT_DB_HOST;
	const username = process.env.AUDIT_DB_USERNAME;
	return Boolean(host && username);
};
