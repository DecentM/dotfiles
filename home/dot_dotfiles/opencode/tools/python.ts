/**
 * Python code execution tool with isolated Docker sandbox.
 * Each execution spawns a fresh container that auto-removes after use.
 * Supports parallel executions with resource isolation.
 */

import { tool } from "@opencode-ai/plugin";

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
  },
  async execute(args) {
    const { code, timeout = DEFAULT_TIMEOUT_MS } = args;

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
      // Spawn docker container with Python
      // Build image inline and run - pass code via stdin to avoid shell escaping issues
      const dockerCommand = `docker run --rm -i --init --network=none --memory=${MEMORY_LIMIT} --cpus=${CPU_LIMIT} $(docker build -q -f ~/.dotfiles/opencode/docker/mcp-python.dockerfile ~/.dotfiles/opencode/docker) -`;

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
**⚠️ TIMED OUT**

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
