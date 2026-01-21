/**
 * Python code execution tool with isolated Docker sandbox.
 * Each execution spawns a fresh container that auto-removes after use.
 * Supports parallel executions with resource isolation.
 */

import { tool } from "@opencode-ai/plugin";
import {
	formatExecutionResult,
	formatNoCodeError,
	runContainer,
} from "../lib/docker";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT_MS = 60_000;
const DOCKERFILE_PATH = "~/.dotfiles/opencode/docker/mcp-python.dockerfile";
const DOCKER_CONTEXT = "~/.dotfiles/opencode/docker";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build the Docker image and return the image ID.
 */
const buildImage = async (): Promise<string> => {
	const proc = Bun.spawn(
		["bash", "-c", `docker build -q -f ${DOCKERFILE_PATH} ${DOCKER_CONTEXT}`],
		{ stdout: "pipe", stderr: "pipe" },
	);
	await proc.exited;
	const imageId = (await new Response(proc.stdout).text()).trim();
	if (!imageId) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Failed to build image: ${stderr}`);
	}
	return imageId;
};

// =============================================================================
// Main Tool
// =============================================================================

export default tool({
	description: `Execute Python code in an isolated sandbox container.

Features:
- Fresh container per execution (parallel-safe)
- Auto-removes after completion
- Network isolated, memory/CPU limited

Returns stdout, stderr, and exit code.`,
	args: {
		code: tool.schema.string().describe("Python code to execute"),
		timeout: tool.schema
			.number()
			.optional()
			.describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`),
	},
	async execute(args) {
		const { code, timeout = DEFAULT_TIMEOUT_MS } = args;

		if (!code.trim()) {
			return formatNoCodeError();
		}

		// Build the image
		const image = await buildImage();

		// Run container with the docker library
		const result = await runContainer({
			image,
			code,
			cmd: ["-"],
			timeout,
			memory: "512m",
			cpus: 1,
			networkMode: "none",
		});

		// Format and return result
		return formatExecutionResult({
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			durationMs: result.durationMs,
			timedOut: result.timedOut,
			runtime: "python",
		});
	},
});
