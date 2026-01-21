/**
 * Custom Docker tool with permission enforcement and auditing.
 * Uses Docker socket directly (not CLI) with:
 * - Allowlist-based operation permissions
 * - SQLite audit logging
 * - Stats and export tools
 */

import { tool } from "@opencode-ai/plugin";

// Import for internal use
import {
	buildOperationPattern,
	type ContainerConfig,
	createContainer,
	createVolume,
	execInContainer,
	// Utils
	formatBytes,
	formatContainerName,
	formatTimestamp,
	getContainerLogs,
	inspectContainer,
	inspectImage,
	// Client functions
	listContainers,
	listImages,
	listNetworks,
	listVolumes,
	logOperation,
	matchOperation,
	pullImage,
	removeContainer,
	removeImage,
	removeVolume,
	startContainer,
	stopContainer,
	updateLogEntry,
	type ValidationContext,
	validateConstraints,
} from "./docker/index";

// =============================================================================
// Main Docker Tool
// =============================================================================

export default tool({
	description: `Execute Docker operations with permission enforcement and audit logging.
Operations are checked against an allowlist before execution.
Denied operations will return an error with the reason.

Uses Docker socket directly - does not spawn docker CLI processes.`,
	args: {
		operation: tool.schema
			.enum([
				"container:list",
				"container:inspect",
				"container:create",
				"container:start",
				"container:stop",
				"container:remove",
				"container:logs",
				"container:exec",
				"image:list",
				"image:pull",
				"image:inspect",
				"image:remove",
				"volume:list",
				"volume:create",
				"volume:remove",
				"network:list",
			])
			.describe("The Docker operation to perform"),
		target: tool.schema
			.string()
			.optional()
			.describe(
				"Target for the operation (container ID/name, image name, volume name)",
			),
		// Container create options
		image: tool.schema
			.string()
			.optional()
			.describe("Image to use for container:create"),
		cmd: tool.schema
			.array(tool.schema.string())
			.optional()
			.describe("Command to run for container:create or container:exec"),
		env: tool.schema
			.array(tool.schema.string())
			.optional()
			.describe("Environment variables (KEY=value format)"),
		workdir: tool.schema
			.string()
			.optional()
			.describe("Working directory inside container"),
		mounts: tool.schema
			.array(tool.schema.string())
			.optional()
			.describe("Volume mounts (source:dest format)"),
		name: tool.schema
			.string()
			.optional()
			.describe("Container name for container:create"),
		// Container logs options
		tail: tool.schema
			.number()
			.optional()
			.describe("Number of log lines to fetch (default 100)"),
		timestamps: tool.schema
			.boolean()
			.optional()
			.describe("Include timestamps in logs"),
		// List options
		all: tool.schema
			.boolean()
			.optional()
			.describe("Include stopped containers for container:list"),
	},
	async execute(args, context) {
		const { operation, target } = args;
		const { sessionID, messageID } = context;

		// Build the operation pattern for matching
		const operationPattern = buildOperationPattern(operation, target);

		// Check permissions
		const match = matchOperation(operationPattern);

		if (match.decision === "deny") {
			// Log the denied attempt
			logOperation({
				sessionId: sessionID,
				messageId: messageID,
				operation,
				target,
				patternMatched: match.pattern,
				decision: "deny",
			});

			// Standardized error format
			const reason = match.reason ?? "Operation not in allowlist";
			const patternInfo = match.pattern ? `\nPattern: ${match.pattern}` : "";
			return `Error: Operation denied\nReason: ${reason}${patternInfo}\n\nOperation: ${operationPattern}`;
		}

		// Build validation context for constraints
		let validationContext: ValidationContext = {};

		// For container:create, build the container config for validation
		if (operation === "container:create" && args.image) {
			const containerConfig = buildContainerConfig(args);
			validationContext = {
				containerConfig,
				imageName: args.image,
				containerName: args.name,
			};
		}

		// For image operations, set image name
		if (operation.startsWith("image:") && target) {
			validationContext.imageName = target;
		}

		// For container operations, set container name
		if (
			operation !== "container:list" &&
			operation !== "container:create" &&
			target
		) {
			validationContext.containerName = target;
		}

		// Check constraints for allowed operations
		if (match.rule) {
			const constraintResult = validateConstraints(
				match.rule,
				validationContext,
			);

			if (!constraintResult.valid) {
				// Log as denied due to constraint violation
				logOperation({
					sessionId: sessionID,
					messageId: messageID,
					operation,
					target,
					paramsJson: JSON.stringify(args),
					patternMatched: match.pattern,
					decision: "deny",
				});

				return `Error: ${constraintResult.violation}\nPattern: ${match.pattern}\n\nOperation: ${operationPattern}`;
			}
		}

		// Log the allowed attempt (will update with result after)
		const logId = logOperation({
			sessionId: sessionID,
			messageId: messageID,
			operation,
			target,
			paramsJson: JSON.stringify(args),
			patternMatched: match.pattern,
			decision: "allow",
		});

		const startTime = performance.now();

		try {
			const result = await executeOperation(operation, args);
			const durationMs = Math.round(performance.now() - startTime);

			// Update log with results
			const summary = result.success ? "success" : (result.error ?? "error");
			updateLogEntry(logId, summary, durationMs);

			if (!result.success) {
				return `Error: ${result.error}\n\nOperation: ${operationPattern}`;
			}

			return result.output;
		} catch (error) {
			const durationMs = Math.round(performance.now() - startTime);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			updateLogEntry(logId, `error: ${errorMessage}`, durationMs);

			return `Error: Operation execution failed: ${errorMessage}\n\nOperation: ${operationPattern}`;
		}
	},
});

// =============================================================================
// Helper Functions
// =============================================================================

interface OperationArgs {
	operation: string;
	target?: string;
	image?: string;
	cmd?: string[];
	env?: string[];
	workdir?: string;
	mounts?: string[];
	name?: string;
	tail?: number;
	timestamps?: boolean;
	all?: boolean;
}

interface OperationResult {
	success: boolean;
	output: string;
	error?: string;
}

/**
 * Build ContainerConfig from args.
 */
const buildContainerConfig = (args: OperationArgs): ContainerConfig => {
	const config: ContainerConfig = {
		Image: args.image!,
		Cmd: args.cmd,
		Env: args.env,
		WorkingDir: args.workdir,
		HostConfig: {},
	};

	if (args.mounts && args.mounts.length > 0) {
		config.HostConfig!.Binds = args.mounts;
	}

	return config;
};

/**
 * Execute a Docker operation.
 */
const executeOperation = async (
	operation: string,
	args: OperationArgs,
): Promise<OperationResult> => {
	switch (operation) {
		// ─────────────────────────────────────────────────────────────────────────
		// Container Operations
		// ─────────────────────────────────────────────────────────────────────────
		case "container:list": {
			const result = await listContainers(args.all ?? false);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const containers = result.data ?? [];
			if (containers.length === 0) {
				return { success: true, output: "No containers found" };
			}

			let output = "# Containers\n\n";
			output += "| ID | Name | Image | Status | Ports |\n";
			output += "|----|------|-------|--------|-------|\n";

			for (const c of containers) {
				const id = c.Id.substring(0, 12);
				const name = formatContainerName(c.Names);
				const ports = c.Ports.map(
					(p) =>
						(p.PublicPort ? `${p.PublicPort}:` : "") +
						`${p.PrivatePort}/${p.Type}`,
				).join(", ");
				output += `| ${id} | ${name} | ${c.Image} | ${c.Status} | ${ports || "-"} |\n`;
			}

			return { success: true, output };
		}

		case "container:inspect": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}

			const result = await inspectContainer(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const c = result.data!;
			let output = `# Container: ${c.Name}\n\n`;
			output += `- **ID**: ${c.Id.substring(0, 12)}\n`;
			output += `- **Image**: ${c.Image}\n`;
			output += `- **Created**: ${c.Created}\n`;
			output += `- **Status**: ${c.State.Status}\n`;
			output += `- **Running**: ${c.State.Running}\n`;
			output += `- **PID**: ${c.State.Pid}\n`;
			output += `- **ExitCode**: ${c.State.ExitCode}\n`;
			output += `\n## Config\n`;
			output += `- **Cmd**: ${c.Config.Cmd?.join(" ") ?? "-"}\n`;
			output += `- **WorkingDir**: ${c.Config.WorkingDir || "-"}\n`;
			output += `- **User**: ${c.Config.User || "root"}\n`;
			output += `\n## Network\n`;
			for (const [name, net] of Object.entries(c.NetworkSettings.Networks)) {
				output += `- **${name}**: ${net.IPAddress}\n`;
			}

			return { success: true, output };
		}

		case "container:create": {
			if (!args.image) {
				return {
					success: false,
					output: "",
					error: "Image required for container:create",
				};
			}

			const config = buildContainerConfig(args);
			const result = await createContainer(config, args.name);

			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const data = result.data!;
			let output = `Container created successfully\n`;
			output += `- **ID**: ${data.Id.substring(0, 12)}\n`;
			if (args.name) {
				output += `- **Name**: ${args.name}\n`;
			}
			if (data.Warnings.length > 0) {
				output += `\n**Warnings**:\n`;
				for (const w of data.Warnings) {
					output += `- ${w}\n`;
				}
			}

			return { success: true, output };
		}

		case "container:start": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}

			const result = await startContainer(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Container ${args.target} started` };
		}

		case "container:stop": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}

			const result = await stopContainer(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Container ${args.target} stopped` };
		}

		case "container:remove": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}

			const result = await removeContainer(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Container ${args.target} removed` };
		}

		case "container:logs": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}

			const result = await getContainerLogs(
				args.target,
				args.tail ?? 100,
				args.timestamps ?? false,
			);

			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const logs = result.data ?? "";
			if (!logs.trim()) {
				return { success: true, output: "(no logs)" };
			}

			return { success: true, output: logs };
		}

		case "container:exec": {
			if (!args.target) {
				return {
					success: false,
					output: "",
					error: "Container ID/name required",
				};
			}
			if (!args.cmd || args.cmd.length === 0) {
				return {
					success: false,
					output: "",
					error: "Command required for container:exec",
				};
			}

			const result = await execInContainer(args.target, args.cmd, {
				workdir: args.workdir,
				env: args.env,
			});

			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const { output, exitCode } = result.data!;
			let response = output || "(no output)";
			if (exitCode !== 0) {
				response = `Exit code: ${exitCode}\n${response}`;
			}

			return { success: true, output: response };
		}

		// ─────────────────────────────────────────────────────────────────────────
		// Image Operations
		// ─────────────────────────────────────────────────────────────────────────
		case "image:list": {
			const result = await listImages();
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const images = result.data ?? [];
			if (images.length === 0) {
				return { success: true, output: "No images found" };
			}

			let output = "# Images\n\n";
			output += "| Repository:Tag | ID | Size | Created |\n";
			output += "|----------------|-----|------|----------|\n";

			for (const img of images) {
				const id = img.Id.replace("sha256:", "").substring(0, 12);
				const tags = img.RepoTags?.join(", ") ?? "<none>";
				const size = formatBytes(img.Size);
				const created = formatTimestamp(img.Created);
				output += `| ${tags} | ${id} | ${size} | ${created} |\n`;
			}

			return { success: true, output };
		}

		case "image:pull": {
			if (!args.target) {
				return { success: false, output: "", error: "Image name required" };
			}

			const result = await pullImage(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return {
				success: true,
				output: `Image ${args.target} pulled successfully`,
			};
		}

		case "image:inspect": {
			if (!args.target) {
				return { success: false, output: "", error: "Image name required" };
			}

			const result = await inspectImage(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const img = result.data!;
			let output = `# Image: ${img.RepoTags.join(", ")}\n\n`;
			output += `- **ID**: ${img.Id.replace("sha256:", "").substring(0, 12)}\n`;
			output += `- **Created**: ${img.Created}\n`;
			output += `- **Size**: ${formatBytes(img.Size)}\n`;
			output += `- **Architecture**: ${img.Architecture}\n`;
			output += `- **OS**: ${img.Os}\n`;
			output += `\n## Config\n`;
			output += `- **Entrypoint**: ${img.Config.Entrypoint?.join(" ") ?? "-"}\n`;
			output += `- **Cmd**: ${img.Config.Cmd?.join(" ") ?? "-"}\n`;
			output += `- **WorkingDir**: ${img.Config.WorkingDir || "-"}\n`;
			output += `- **User**: ${img.Config.User || "root"}\n`;

			return { success: true, output };
		}

		case "image:remove": {
			if (!args.target) {
				return { success: false, output: "", error: "Image name required" };
			}

			const result = await removeImage(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Image ${args.target} removed` };
		}

		// ─────────────────────────────────────────────────────────────────────────
		// Volume Operations
		// ─────────────────────────────────────────────────────────────────────────
		case "volume:list": {
			const result = await listVolumes();
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const volumes = result.data?.Volumes ?? [];
			if (volumes.length === 0) {
				return { success: true, output: "No volumes found" };
			}

			let output = "# Volumes\n\n";
			output += "| Name | Driver | Mountpoint |\n";
			output += "|------|--------|------------|\n";

			for (const v of volumes) {
				output += `| ${v.Name} | ${v.Driver} | ${v.Mountpoint} |\n`;
			}

			return { success: true, output };
		}

		case "volume:create": {
			if (!args.target) {
				return { success: false, output: "", error: "Volume name required" };
			}

			const result = await createVolume(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Volume ${args.target} created` };
		}

		case "volume:remove": {
			if (!args.target) {
				return { success: false, output: "", error: "Volume name required" };
			}

			const result = await removeVolume(args.target);
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			return { success: true, output: `Volume ${args.target} removed` };
		}

		// ─────────────────────────────────────────────────────────────────────────
		// Network Operations
		// ─────────────────────────────────────────────────────────────────────────
		case "network:list": {
			const result = await listNetworks();
			if (!result.success) {
				return { success: false, output: "", error: result.error };
			}

			const networks = result.data ?? [];
			if (networks.length === 0) {
				return { success: true, output: "No networks found" };
			}

			let output = "# Networks\n\n";
			output += "| Name | ID | Driver | Scope |\n";
			output += "|------|-----|--------|-------|\n";

			for (const n of networks) {
				const id = n.Id.substring(0, 12);
				output += `| ${n.Name} | ${id} | ${n.Driver} | ${n.Scope} |\n`;
			}

			return { success: true, output };
		}

		default:
			return {
				success: false,
				output: "",
				error: `Unknown operation: ${operation}`,
			};
	}
};
