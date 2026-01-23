/**
 * Python code execution tool with isolated Docker sandbox.
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
const DOCKERFILE_PATH = 'tool-python.dockerfile'

// =============================================================================
// Main Tool
// =============================================================================

export default tool({
  description: `Execute Python code in an isolated sandbox container.

Features:
- Builds container on first use
- Fresh container per execution (parallel-safe)
- Auto-removes after completion
- Network isolated, memory/CPU limited

Returns stdout, stderr, and exit code.`,
  args: {
    code: tool.schema.string().describe('Python code to execute'),
    timeout: tool.schema
      .number()
      .describe(`Timeout in milliseconds`),
  },
  async execute(args) {
    const { code, timeout } = args

    if (!code.trim()) {
      return formatNoCodeError()
    }

    // Build the image
    const buildResult = await buildImage(DOCKER_CONTEXT, {
      dockerfile: DOCKERFILE_PATH,
      quiet: true,
    })

    if (!buildResult.success || !buildResult.data) {
      return formatErrorResult(buildResult.error ?? 'Failed to build image', 0, 'python')
    }

    // Run container with the docker library
    const result = await runContainer({
      image: buildResult.data,
      code,
      cmd: ['-'],
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
      runtime: 'python',
    })
  },
})
