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
const MAX_MEM_MB = 512
const MAX_CPU = 1

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
- Preinstallable packages

Returns stdout, stderr, and exit code.`,
  args: {
    code: tool.schema.string().describe('JavaScript or TypeScript code to execute'),
    timeout: tool.schema
      .number()
      .describe(`Timeout in milliseconds`),
    packages: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe('List of packages to preinstall during build (add some timeout for each)'),
    node_version: tool.schema
      .string()
      .optional()
      .describe(`Exact Node version to use (default: ${process.versions.node})`),
    esm: tool.schema
      .boolean()
      .optional()
      .describe('If false, the sandbox will be set up for commonjs. If true, it will be ESM ("module"). Default: true')
  },
  async execute(args) {
    const { code, timeout, packages = [], node_version = process.versions.node, esm = true } = args

    if (!code.trim()) {
      return formatNoCodeError()
    }

    // Build the image
    const buildResult = await buildImage(DOCKER_CONTEXT, {
      dockerfile: DOCKERFILE_PATH,
      quiet: true,
      buildArgs: {
        INSTALL_PACKAGES: packages.join(' '),
        NODE_VERSION: node_version,
        PACKAGE_TYPE: esm ? 'module' : 'commonjs'
      }
    })

    if (!buildResult.success || !buildResult.data) {
      return formatErrorResult(buildResult.error ?? 'Failed to build image', 0)
    }

    // Run container with the docker library
    const result = await runContainer({
      image: buildResult.data,
      code,
      cmd: ['-'],
      timeout,
      memory: `${MAX_MEM_MB}m`,
      cpus: MAX_CPU,
      networkMode: 'none',
    })

    // Format and return result
    return formatExecutionResult({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    })
  },
})
