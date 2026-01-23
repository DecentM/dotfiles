/**
 * Output formatting utilities for container execution results.
 */

import type { ExecutionResult } from './types'

// =============================================================================
// Constants
// =============================================================================

/** Default maximum output size per stream (100KB) */
const DEFAULT_MAX_OUTPUT_SIZE = 100 * 1024

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * Truncate output if it exceeds the maximum size.
 * @param output - The output string to potentially truncate
 * @param name - Name of the output stream (for the truncation message)
 * @param maxSize - Maximum size in bytes (default: 100KB)
 * @returns The original or truncated output with a message
 */
export const truncateOutput = (
  output: string,
  name: string,
  maxSize: number = DEFAULT_MAX_OUTPUT_SIZE
): string => {
  if (output.length <= maxSize) {
    return output
  }

  return `${output.substring(0, maxSize)}\n...[${name} truncated, ${output.length} bytes total]`
}

/**
 * Format an execution result as Markdown.
 *
 * Produces output like:
 * ```markdown
 * ## Execution Result
 *
 * **Exit Code:** 0
 * **Duration:** 123ms
 * **Runtime:** node
 *
 * ### stdout
 * ```
 * output here
 * ```
 *
 * ### stderr
 * ```
 * error here if any
 * ```
 * ```
 *
 * @param result - The execution result to format
 * @returns Formatted Markdown string
 */
export const formatExecutionResult = (result: ExecutionResult): string => {
  const { exitCode, stdout, stderr, durationMs, timedOut } = result

  // Truncate outputs
  const truncatedStdout = truncateOutput(stdout, 'stdout')
  const truncatedStderr = truncateOutput(stderr, 'stderr')

  // Build header lines
  const headerLines = [
    '## Execution Result',
    '',
    `**Exit Code:** ${exitCode}`,
    `**Duration:** ${durationMs}ms`,
  ]

  if (timedOut) {
    headerLines.push('**TIMED OUT**')
  }

  // Build output sections
  const outputSection = [
    '',
    '### stdout',
    '```',
    truncatedStdout.trim() || '(empty)',
    '```',
    '',
    '### stderr',
    '```',
    truncatedStderr.trim() || '(empty)',
    '```',
  ]

  return [...headerLines, ...outputSection].join('\n')
}

/**
 * Format an error result as Markdown.
 * Convenience function for error cases.
 *
 * @param error - Error message
 * @param durationMs - Duration in milliseconds
 * @param runtime - Optional runtime identifier
 * @returns Formatted Markdown string
 */
export const formatErrorResult = (error: string, durationMs: number, runtime?: string): string => {
  return formatExecutionResult({
    exitCode: -1,
    stdout: '',
    stderr: error,
    durationMs,
    timedOut: false,
  })
}

/**
 * Format a "no code provided" error as Markdown.
 *
 * @returns Formatted Markdown string
 */
export const formatNoCodeError = (): string => {
  return formatExecutionResult({
    exitCode: 1,
    stdout: '',
    stderr: 'Error: No code provided',
    durationMs: 0,
    timedOut: false,
  })
}
