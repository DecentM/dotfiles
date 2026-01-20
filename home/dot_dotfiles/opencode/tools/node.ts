/**
 * Node.js/TypeScript/Deno code execution tool with isolated Docker sandbox.
 * Each execution spawns a fresh container that auto-removes after use.
 * Supports parallel executions with resource isolation.
 */

import { tool } from "@opencode-ai/plugin";

// Default timeout in milliseconds
const DEFAULT_TIMEOUT_MS = 30_000;

// Resource constraints
const MEMORY_LIMIT = "512m";
const CPU_LIMIT = "1";

// Runtime types
type Runtime = "node" | "tsx" | "deno";

// Build docker command based on runtime
const buildDockerCommand = (runtime: Runtime): string => {
  const baseImage = "$(docker build -q -f ~/.dotfiles/opencode/docker/mcp-node.dockerfile ~/.dotfiles/opencode/docker)";
  const baseFlags = `--rm -i --init --network=none --memory=${MEMORY_LIMIT} --cpus=${CPU_LIMIT}`;

  switch (runtime) {
    case "node":
      // Default: node reads from stdin with -
      return `docker run ${baseFlags} ${baseImage} -`;

    case "tsx":
      // TypeScript via npx tsx, reading from stdin
      return `docker run ${baseFlags} --entrypoint npx ${baseImage} tsx -`;

    case "deno":
      // Deno with run - to read from stdin
      return `docker run ${baseFlags} --entrypoint deno ${baseImage} run -`;
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
    code: tool.schema.string().describe("JavaScript or TypeScript code to execute"),
    runtime: tool.schema
      .enum(["node", "tsx", "deno"])
      .optional()
      .describe("Runtime to use: 'node' (default), 'tsx' (TypeScript), or 'deno'"),
    timeout: tool.schema
      .number()
      .optional()
      .describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`),
  },
  async execute(args) {
    const { code, runtime = "node", timeout = DEFAULT_TIMEOUT_MS } = args;

    // Validate input
    if (!code.trim()) {
      return `## Execution Result

**Exit Code:** 1

### stdout
\`\`\`
(empty)
\`\`\`

### stderr
\`\`\`
Error: No code provided
\`\`\`
`;
    }

    const startTime = performance.now();

    try {
      // Build docker command based on runtime
      const dockerCommand = buildDockerCommand(runtime as Runtime);

      const proc = Bun.spawn(["bash", "-c", dockerCommand], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Write code to stdin and close
      proc.stdin.write(code);
      proc.stdin.end();

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
        const timeoutStderr = `Execution timed out after ${timeout}ms and was terminated.\n${stderr}`.trim();
        return `## Execution Result

**Exit Code:** -2
**Duration:** ${durationMs}ms
**Runtime:** ${runtime}
**TIMED OUT**

### stdout
\`\`\`
${stdout.trim() || '(empty)'}
\`\`\`

### stderr
\`\`\`
${timeoutStderr || '(empty)'}
\`\`\`
`;
      }

      // Truncate very long output
      const MAX_OUTPUT = 100 * 1024; // 100KB per stream
      const truncate = (s: string, name: string): string => {
        if (s.length > MAX_OUTPUT) {
          return `${s.substring(0, MAX_OUTPUT)}\n...[${name} truncated, ${s.length} bytes total]`;
        }
        return s;
      };

      return `## Execution Result

**Exit Code:** ${exitCode}
**Duration:** ${durationMs}ms
**Runtime:** ${runtime}

### stdout
\`\`\`
${truncate(stdout, "stdout") || '(empty)'}
\`\`\`

### stderr
\`\`\`
${truncate(stderr, "stderr") || '(empty)'}
\`\`\`
`;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = error instanceof Error ? error.message : String(error);

      // Check for common Docker errors
      if (message.includes("Cannot connect to the Docker daemon")) {
        return `## Execution Result

**Exit Code:** -1
**Duration:** ${durationMs}ms
**Runtime:** ${runtime}

### stdout
\`\`\`
(empty)
\`\`\`

### stderr
\`\`\`
Docker daemon not running. Start Docker and try again.

Original error: ${message}
\`\`\`
`;
      }

      return `## Execution Result

**Exit Code:** -1
**Duration:** ${durationMs}ms
**Runtime:** ${runtime}

### stdout
\`\`\`
(empty)
\`\`\`

### stderr
\`\`\`
Execution failed: ${message}
\`\`\`
`;
    }
  },
});
