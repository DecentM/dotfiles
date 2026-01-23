/**
 * Node.js/TypeScript/Deno code execution tool with isolated Docker sandbox.
 * Each execution spawns a fresh container that auto-removes after use.
 * Supports parallel executions with resource isolation.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { tool } from '@opencode-ai/plugin'
import {
  buildImage,
  formatErrorResult,
  formatExecutionResult,
  formatNoCodeError,
  runContainer,
} from '../lib/docker'

// =============================================================================
// Constants
// =============================================================================

const DOCKER_CONTEXT = join(homedir(), '.dotfiles/opencode/docker')
const DOCKERFILE_PATH = 'tool-node.dockerfile'

type Runtime = 'node' | 'tsx' | 'deno'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get the command array for the given runtime.
 */
const getCommand = (runtime: Runtime): string[] => {
  switch (runtime) {
    case 'node':
      return ['-']
    case 'tsx':
      return ['npx', 'tsx', '-']
    case 'deno':
      return ['deno', 'run', '-']
  }
}

// =============================================================================
// Main Tool
// =============================================================================

export default tool({
  description: `Execute JavaScript/TypeScript code in an isolated sandbox container.

Features:
- Builds container on first use
- Fresh container per execution (parallel-safe)
- Auto-removes after completion
- Network isolated, memory/CPU limited
- Multiple runtimes: Node.js, TypeScript (tsx), or Deno

Returns stdout, stderr, and exit code.`,
  args: {
    code: tool.schema.string().describe('JavaScript or TypeScript code to execute'),
    runtime: tool.schema
      .enum(['node', 'tsx', 'deno'])
      .optional()
      .describe("Runtime to use: 'node' (default), 'tsx' (TypeScript), or 'deno'"),
    timeout: tool.schema
      .number()
      .describe(`Timeout in milliseconds`),
  },
  async execute(args) {
    const { code, runtime = 'node', timeout } = args

    if (!code.trim()) {
      return formatNoCodeError()
    }

    // Build the image
    const buildResult = await buildImage(DOCKER_CONTEXT, {
      dockerfile: DOCKERFILE_PATH,
      quiet: true,
    })

    if (!buildResult.success || !buildResult.data) {
      return formatErrorResult(buildResult.error ?? 'Failed to build image', 0, runtime)
    }

    // Run container with the docker library
    const result = await runContainer({
      image: buildResult.data,
      code,
      cmd: getCommand(runtime as Runtime),
      timeout,
      memory: '512m',
      cpus: 1,
      networkMode: 'none',
    })

    // Format and return result
    return formatExecutionResult({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      runtime,
    })
  },
})
