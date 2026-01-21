/**
 * Node.js/TypeScript/Deno code execution tool with isolated Docker sandbox.
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

const DEFAULT_TIMEOUT_MS = 30_000;
const DOCKERFILE_PATH = "~/.dotfiles/opencode/docker/mcp-node.dockerfile";
const DOCKER_CONTEXT = "~/.dotfiles/opencode/docker";

type Runtime = "node" | "tsx" | "deno";

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

/**
 * Get the command array for the given runtime.
 */
const getCommand = (runtime: Runtime): string[] => {
	switch (runtime) {
		case "node":
			return ["-"];
		case "tsx":
			return ["npx", "tsx", "-"];
		case "deno":
			return ["deno", "run", "-"];
	}
};

// =============================================================================
// Main Tool
// =============================================================================

export default tool({
	description: `Execute JavaScript/TypeScript code in an isolated sandbox container.

Features:
- Fresh container per execution (parallel-safe)
- Auto-removes after completion
- Network isolated, memory/CPU limited
- Multiple runtimes: Node.js, TypeScript (tsx), or Deno

Returns stdout, stderr, and exit code.`,
	args: {
		code: tool.schema
			.string()
			.describe("JavaScript or TypeScript code to execute"),
		runtime: tool.schema
			.enum(["node", "tsx", "deno"])
			.optional()
			.describe(
				"Runtime to use: 'node' (default), 'tsx' (TypeScript), or 'deno'",
			),
		timeout: tool.schema
			.number()
			.optional()
			.describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`),
	},
	async execute(args) {
		const { code, runtime = "node", timeout = DEFAULT_TIMEOUT_MS } = args;

		if (!code.trim()) {
			return formatNoCodeError();
		}

		// Build the image
		const image = await buildImage();

		// Run container with the docker library
		const result = await runContainer({
			image,
			code,
			cmd: getCommand(runtime as Runtime),
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
			runtime,
		});
	},
});
