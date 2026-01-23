/**
 * High-level container runner for code execution.
 * Provides a simplified interface for running containers with code input.
 */

import {
  attachAndWriteStdin,
  createContainer,
  getContainerLogsSeparated,
  removeContainer,
  startContainer,
  stopContainer,
  waitContainer,
} from './client'
import type { ContainerConfig, RunContainerOptions, RunContainerResult } from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MEMORY = '512m'
const DEFAULT_CPUS = 1
const DEFAULT_NETWORK_MODE = 'none'
const STOP_GRACE_PERIOD_MS = 2_000

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse memory string to bytes.
 * Supports formats like "512m", "1g", "1024k", or raw bytes.
 * @param memory - Memory limit string
 */
const parseMemoryToBytes = (memory: string): number => {
  const match = memory.match(/^(\d+)([kmgKMG]?)$/)
  if (!match) {
    return 512 * 1024 * 1024 // Default to 512MB
  }

  const value = Number.parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  switch (unit) {
    case 'k':
      return value * 1024
    case 'm':
      return value * 1024 * 1024
    case 'g':
      return value * 1024 * 1024 * 1024
    default:
      return value
  }
}

/**
 * Convert CPU count to NanoCPUs (Docker API format).
 * @param cpus - Number of CPUs
 */
const cpusToNano = (cpus: number): number => {
  return cpus * 1_000_000_000
}

/**
 * Generate a unique container name.
 */
const generateContainerName = (): string => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `opencode-exec-${timestamp}-${random}`
}

/**
 * Create a promise that rejects after a timeout.
 * @param ms - Timeout in milliseconds
 */
const createTimeoutPromise = <T>(ms: number): Promise<T> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT'))
    }, ms)
  })
}

// =============================================================================
// Container Runner
// =============================================================================

/**
 * Run a container with the given options and return the result.
 *
 * This function:
 * 1. Creates a container with OpenStdin enabled
 * 2. Starts the container
 * 3. Waits for completion with timeout handling
 * 4. On timeout: stops gracefully (SIGTERM), then forces (SIGKILL)
 * 5. Gets logs (stdout/stderr separately)
 * 6. Cleans up the container
 * 7. Returns the result with exitCode, stdout, stderr, duration
 *
 * @param options - Container run options
 * @returns Result with exitCode, stdout, stderr, durationMs, timedOut
 */
export const runContainer = async (options: RunContainerOptions): Promise<RunContainerResult> => {
  const {
    image,
    code,
    cmd,
    env,
    workingDir,
    memory = DEFAULT_MEMORY,
    cpus = DEFAULT_CPUS,
    networkMode = DEFAULT_NETWORK_MODE,
    timeout = DEFAULT_TIMEOUT_MS,
    autoRemove = true,
    name,
  } = options

  const startTime = performance.now()
  const containerName = name ?? generateContainerName()
  let containerId = ''
  let timedOut = false

  // Build container configuration
  const config: ContainerConfig = {
    Image: image,
    OpenStdin: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    HostConfig: {
      Memory: parseMemoryToBytes(memory),
      NanoCpus: cpusToNano(cpus),
      NetworkMode: networkMode,
      AutoRemove: false, // We handle removal ourselves for log retrieval
    },
  }

  if (cmd) {
    config.Cmd = cmd
  }

  if (env) {
    config.Env = env
  }

  if (workingDir) {
    config.WorkingDir = workingDir
  }

  try {
    // Create container
    const createResult = await createContainer(config, containerName)
    if (!createResult.success || !createResult.data) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: createResult.error ?? 'Failed to create container',
        durationMs: Math.round(performance.now() - startTime),
        timedOut: false,
        containerId: '',
      }
    }

    containerId = createResult.data.Id

    // For code execution, we need to write code to stdin
    // Use Docker socket API to attach and pipe stdin
    if (code) {
      // Start container first
      const startResult = await startContainer(containerId)
      if (!startResult.success) {
        return {
          exitCode: -1,
          stdout: '',
          stderr: startResult.error ?? 'Failed to start container',
          durationMs: Math.round(performance.now() - startTime),
          timedOut: false,
          containerId,
        }
      }

      // Attach and write code to stdin via Docker socket API
      const attachResult = await attachAndWriteStdin(containerId, code)
      if (!attachResult.success) {
        // Non-fatal: container may still run, just log the issue
        console.warn(`Attach stdin warning: ${attachResult.error}`)
      }

      // Wait for container with timeout
      try {
        const waitPromise = waitContainer(containerId)
        const result = await Promise.race([waitPromise, createTimeoutPromise<never>(timeout)])

        if (!result.success) {
          throw new Error(result.error ?? 'Wait failed')
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          timedOut = true
          // Graceful stop with SIGTERM
          await stopContainer(containerId, 2)

          // If still running after grace period, force kill
          await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_PERIOD_MS))
          try {
            await stopContainer(containerId, 0)
          } catch {
            // Container may already be stopped
          }
        } else {
          throw error
        }
      }
    } else {
      // No code to pipe, just start and wait
      const startResult = await startContainer(containerId)
      if (!startResult.success) {
        return {
          exitCode: -1,
          stdout: '',
          stderr: startResult.error ?? 'Failed to start container',
          durationMs: Math.round(performance.now() - startTime),
          timedOut: false,
          containerId,
        }
      }

      // Wait for container with timeout
      try {
        const waitPromise = waitContainer(containerId)
        const result = await Promise.race([waitPromise, createTimeoutPromise<never>(timeout)])

        if (!result.success) {
          throw new Error(result.error ?? 'Wait failed')
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          timedOut = true
          await stopContainer(containerId, 2)
          await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_PERIOD_MS))
          try {
            await stopContainer(containerId, 0)
          } catch {
            // Container may already be stopped
          }
        } else {
          throw error
        }
      }
    }

    // Get logs (separated by stream)
    const logsResult = await getContainerLogsSeparated(containerId, {
      tail: 10000, // Get substantial output
    })

    const stdout = logsResult.success && logsResult.data ? logsResult.data.stdout : ''
    const stderr = logsResult.success && logsResult.data ? logsResult.data.stderr : ''

    // Get exit code by inspecting container
    const { inspectContainer } = await import('./client')
    const inspectResult = await inspectContainer(containerId)
    const exitCode =
      inspectResult.success && inspectResult.data
        ? inspectResult.data.State.ExitCode
        : timedOut
          ? -2
          : -1

    const durationMs = Math.round(performance.now() - startTime)

    // Clean up container
    if (autoRemove && containerId) {
      await removeContainer(containerId, true, false)
    }

    return {
      exitCode: timedOut ? -2 : exitCode,
      stdout,
      stderr: timedOut
        ? `Execution timed out after ${timeout}ms and was terminated.\n${stderr}`.trim()
        : stderr,
      durationMs,
      timedOut,
      containerId,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const durationMs = Math.round(performance.now() - startTime)

    // Attempt cleanup
    if (containerId && autoRemove) {
      try {
        await removeContainer(containerId, true, false)
      } catch {
        // Ignore cleanup errors
      }
    }

    // Check for common Docker errors
    if (
      errorMessage.includes('Cannot connect to Docker') ||
      errorMessage.includes('ENOENT') ||
      errorMessage.includes('EACCES')
    ) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: 'Docker daemon not running. Start Docker and try again.',
        durationMs,
        timedOut: false,
        containerId,
      }
    }

    return {
      exitCode: -1,
      stdout: '',
      stderr: `Execution failed: ${errorMessage}`,
      durationMs,
      timedOut: false,
      containerId,
    }
  }
}
