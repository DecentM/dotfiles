/**
 * Python code execution tool with isolated Docker sandbox.
 * Each execution spawns a fresh container that auto-removes after use.
 * Supports parallel executions with resource isolation.
 */

import { tool } from "@opencode-ai/plugin";

// Docker image name - matches the dockerfile
const DOCKER_IMAGE = "opencode/sandbox-python";

// Default timeout in milliseconds
const DEFAULT_TIMEOUT_MS = 60_000;

// Resource constraints
const MEMORY_LIMIT = "512m";
const CPU_LIMIT = "1";

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
    reset: tool.schema
      .boolean()
      .optional()
      .describe("Ignored - kept for API compatibility. Each execution is already isolated."),
  },
  async execute(args) {
    const { code, timeout = DEFAULT_TIMEOUT_MS } = args;

    // Validate input
    if (!code.trim()) {
      return {
        stdout: "",
        stderr: "Error: No code provided",
        exitCode: 1,
      };
    }

    const startTime = performance.now();

    try {
      // Spawn docker container with Python
      // Pass code via stdin to avoid shell escaping issues
      const proc = Bun.spawn(
        [
          "docker",
          "run",
          "--rm", // Auto-remove after exit
          "-i", // Keep stdin open
          "--init", // Proper signal handling
          "--network=none", // Network isolation
          `--memory=${MEMORY_LIMIT}`,
          `--cpus=${CPU_LIMIT}`,
          DOCKER_IMAGE,
          "-", // Read script from stdin
        ],
        {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      // Write code to stdin and close
      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(code));
      await writer.close();

      // Handle timeout with process cleanup
      let timedOut = false;

      const terminateProcess = async (): Promise<void> => {
        try {
          // SIGTERM first for graceful shutdown
          proc.kill("SIGTERM");

          // Wait briefly for graceful shutdown
          const gracePeriod = 2000; // 2 seconds - docker needs time to clean up
          const exited = await Promise.race([
            proc.exited.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), gracePeriod)),
          ]);

          // Escalate to SIGKILL if needed
          if (!exited) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // Process may have exited
            }
          }
        } catch {
          // Process may have already exited
        }
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        terminateProcess();
      }, timeout);

      // Wait for completion
      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      const durationMs = Math.round(performance.now() - startTime);

      // Read output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // Handle timeout
      if (timedOut) {
        return {
          stdout: stdout.trim(),
          stderr: `Execution timed out after ${timeout}ms and was terminated.\n${stderr}`.trim(),
          exitCode: -2,
          durationMs,
          timedOut: true,
        };
      }

      // Truncate very long output
      const MAX_OUTPUT = 100 * 1024; // 100KB per stream
      const truncate = (s: string, name: string): string => {
        if (s.length > MAX_OUTPUT) {
          return `${s.substring(0, MAX_OUTPUT)}\n...[${name} truncated, ${s.length} bytes total]`;
        }
        return s;
      };

      return {
        stdout: truncate(stdout, "stdout"),
        stderr: truncate(stderr, "stderr"),
        exitCode,
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = error instanceof Error ? error.message : String(error);

      // Check for common Docker errors
      if (message.includes("Cannot connect to the Docker daemon")) {
        return {
          stdout: "",
          stderr: `Docker daemon not running. Start Docker and try again.\n\nOriginal error: ${message}`,
          exitCode: -1,
          durationMs,
        };
      }

      if (message.includes("No such image") || message.includes("Unable to find image")) {
        return {
          stdout: "",
          stderr: `Docker image "${DOCKER_IMAGE}" not found. Original error: ${message}`,
          exitCode: -1,
          durationMs,
        };
      }

      return {
        stdout: "",
        stderr: `Execution failed: ${message}`,
        exitCode: -1,
        durationMs,
      };
    }
  },
});
