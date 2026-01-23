/**
 * Tests for the Docker output formatting utilities.
 * Tests truncateOutput, formatExecutionResult, and related functions.
 */

import { describe, expect, test } from 'bun:test'
import {
  truncateOutput,
  formatExecutionResult,
  formatErrorResult,
  formatNoCodeError,
} from './format'
import type { ExecutionResult } from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_OUTPUT_SIZE = 100 * 1024 // 100KB

// =============================================================================
// truncateOutput
// =============================================================================

describe('truncateOutput', () => {
  describe('output within size limit', () => {
    test('returns unchanged output when shorter than limit', () => {
      const output = 'Hello, World!'
      const result = truncateOutput(output, 'stdout')
      expect(result).toBe('Hello, World!')
    })

    test('returns unchanged output when exactly at limit', () => {
      const output = 'x'.repeat(100)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result).toBe(output)
    })

    test('returns empty string unchanged', () => {
      const result = truncateOutput('', 'stdout')
      expect(result).toBe('')
    })

    test('returns single character unchanged', () => {
      const result = truncateOutput('a', 'stdout')
      expect(result).toBe('a')
    })

    test('uses default max size of 100KB', () => {
      const output = 'x'.repeat(DEFAULT_MAX_OUTPUT_SIZE)
      const result = truncateOutput(output, 'stdout')
      expect(result).toBe(output)
    })
  })

  describe('output exceeding size limit', () => {
    test('truncates output longer than limit', () => {
      const output = 'x'.repeat(150)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result.length).toBeLessThan(output.length)
    })

    test('includes truncation message', () => {
      const output = 'x'.repeat(150)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result).toContain('[stdout truncated')
    })

    test('includes stream name in truncation message', () => {
      const output = 'x'.repeat(150)
      const result = truncateOutput(output, 'stderr', 100)
      expect(result).toContain('[stderr truncated')
    })

    test('includes total byte count in truncation message', () => {
      const output = 'x'.repeat(150)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result).toContain('150 bytes total')
    })

    test('preserves beginning of output', () => {
      const output = 'BEGINNING' + 'x'.repeat(200)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result.startsWith('BEGINNING')).toBe(true)
    })

    test('adds newline before truncation message', () => {
      const output = 'x'.repeat(150)
      const result = truncateOutput(output, 'stdout', 100)
      expect(result).toContain('\n...[stdout truncated')
    })
  })

  describe('custom max size', () => {
    test('respects custom max size smaller than default', () => {
      const output = 'x'.repeat(200)
      const result = truncateOutput(output, 'stdout', 50)
      expect(result).toContain('...[stdout truncated')
      expect(result.startsWith('x'.repeat(50))).toBe(true)
    })

    test('respects custom max size larger than default', () => {
      const largeLimit = 200 * 1024 // 200KB
      const output = 'x'.repeat(150 * 1024)
      const result = truncateOutput(output, 'stdout', largeLimit)
      expect(result).toBe(output)
    })

    test('handles max size of 0', () => {
      const output = 'Hello'
      const result = truncateOutput(output, 'stdout', 0)
      expect(result).toContain('[stdout truncated')
      expect(result).toContain('5 bytes total')
    })

    test('handles max size of 1', () => {
      const output = 'Hello'
      const result = truncateOutput(output, 'stdout', 1)
      expect(result.startsWith('H')).toBe(true)
    })
  })

  describe('edge cases', () => {
    test('handles unicode characters', () => {
      const output = '\u4e16\u754c'.repeat(100) // Chinese characters
      const result = truncateOutput(output, 'stdout', 50)
      // Should handle multi-byte characters
      expect(typeof result).toBe('string')
    })

    test('handles newlines in output', () => {
      const output = 'line1\nline2\nline3\n'.repeat(100)
      const result = truncateOutput(output, 'stdout', 50)
      expect(result).toContain('...[stdout truncated')
    })

    test('handles ANSI escape codes', () => {
      const output = '\x1b[31mRed Text\x1b[0m'.repeat(50)
      const result = truncateOutput(output, 'stdout', 100)
      expect(typeof result).toBe('string')
    })

    test('handles binary-like content', () => {
      const output = '\x00\x01\x02\x03'.repeat(50)
      const result = truncateOutput(output, 'stdout', 100)
      expect(typeof result).toBe('string')
    })
  })
})

// =============================================================================
// formatExecutionResult
// =============================================================================

describe('formatExecutionResult', () => {
  describe('successful execution', () => {
    test('formats basic successful result', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'Hello, World!',
        stderr: '',
        durationMs: 150,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('## Execution Result')
      expect(formatted).toContain('**Exit Code:** 0')
      expect(formatted).toContain('**Duration:** 150ms')
      expect(formatted).toContain('Hello, World!')
    })

    test('includes runtime when provided', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'output',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        runtime: 'node',
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Runtime:** node')
    })

    test('includes both stdout and stderr sections', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'stdout content',
        stderr: 'stderr content',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('### stdout')
      expect(formatted).toContain('### stderr')
      expect(formatted).toContain('stdout content')
      expect(formatted).toContain('stderr content')
    })

    test('shows (empty) for empty stdout', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '',
        stderr: 'some error',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('(empty)')
    })

    test('shows (empty) for empty stderr', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'output',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('(empty)')
    })

    test('shows (empty) for whitespace-only output', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '   \n\t  ',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      // After trim, whitespace becomes empty
      expect(formatted).toContain('(empty)')
    })
  })

  describe('failed execution', () => {
    test('formats error result with non-zero exit code', () => {
      const result: ExecutionResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Something went wrong',
        durationMs: 50,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Exit Code:** 1')
      expect(formatted).toContain('Error: Something went wrong')
    })

    test('formats timeout result with TIMED OUT indicator', () => {
      const result: ExecutionResult = {
        exitCode: -2,
        stdout: 'partial output',
        stderr: 'Execution timed out',
        durationMs: 30000,
        timedOut: true,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**TIMED OUT**')
      expect(formatted).toContain('**Exit Code:** -2')
    })

    test('formats negative exit code', () => {
      const result: ExecutionResult = {
        exitCode: -1,
        stdout: '',
        stderr: 'Container creation failed',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Exit Code:** -1')
    })
  })

  describe('output truncation', () => {
    test('truncates long stdout', () => {
      const longOutput = 'x'.repeat(200 * 1024) // 200KB
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: longOutput,
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('[stdout truncated')
      expect(formatted.length).toBeLessThan(longOutput.length)
    })

    test('truncates long stderr', () => {
      const longError = 'error line\n'.repeat(50000)
      const result: ExecutionResult = {
        exitCode: 1,
        stdout: '',
        stderr: longError,
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('[stderr truncated')
    })
  })

  describe('Markdown formatting', () => {
    test('uses proper heading levels', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'output',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('## Execution Result')
      expect(formatted).toContain('### stdout')
      expect(formatted).toContain('### stderr')
    })

    test('wraps output in code blocks', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: "console.log('hello')",
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('```')
    })

    test('uses bold for metadata', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Exit Code:**')
      expect(formatted).toContain('**Duration:**')
    })
  })

  describe('all runtimes', () => {
    const runtimes = ['node', 'tsx', 'deno', 'python']

    for (const runtime of runtimes) {
      test(`formats ${runtime} runtime correctly`, () => {
        const result: ExecutionResult = {
          exitCode: 0,
          stdout: 'output',
          stderr: '',
          durationMs: 100,
          timedOut: false,
          runtime,
        }

        const formatted = formatExecutionResult(result)

        expect(formatted).toContain(`**Runtime:** ${runtime}`)
      })
    }
  })

  describe('edge cases', () => {
    test('handles special characters in output', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'Special chars: <>&"\'`${}[]|\\',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('<>&')
    })

    test('handles unicode in output', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '\u4f60\u597d\u4e16\u754c (Hello World in Chinese)',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('\u4f60\u597d')
    })

    test('handles emoji in output', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: 'Success! \u{1F389}\u{1F600}',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('\u{1F389}')
    })

    test('handles ANSI escape codes in output', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '\x1b[32mGreen Text\x1b[0m',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('Green Text')
    })

    test('handles zero duration', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Duration:** 0ms')
    })

    test('handles very long duration', () => {
      const result: ExecutionResult = {
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 3600000, // 1 hour
        timedOut: false,
      }

      const formatted = formatExecutionResult(result)

      expect(formatted).toContain('**Duration:** 3600000ms')
    })
  })
})

// =============================================================================
// formatErrorResult
// =============================================================================

describe('formatErrorResult', () => {
  test('formats error with message', () => {
    const formatted = formatErrorResult('Connection refused', 50)

    expect(formatted).toContain('## Execution Result')
    expect(formatted).toContain('**Exit Code:** -1')
    expect(formatted).toContain('**Duration:** 50ms')
    expect(formatted).toContain('Connection refused')
  })

  test('includes runtime when provided', () => {
    const formatted = formatErrorResult('Error occurred', 100, 'python')

    expect(formatted).toContain('**Runtime:** python')
  })

  test('sets exit code to -1', () => {
    const formatted = formatErrorResult('Any error', 0)

    expect(formatted).toContain('**Exit Code:** -1')
  })

  test('puts error message in stderr section', () => {
    const formatted = formatErrorResult('Error message here', 100)

    expect(formatted).toContain('### stderr')
    expect(formatted).toContain('Error message here')
  })

  test('leaves stdout empty', () => {
    const formatted = formatErrorResult('Error', 100)

    // Check that stdout section shows (empty)
    const lines = formatted.split('\n')
    const stdoutIndex = lines.findIndex((l) => l.includes('### stdout'))
    expect(stdoutIndex).toBeGreaterThan(-1)
    // Next code block should contain (empty)
    expect(lines.slice(stdoutIndex, stdoutIndex + 4).join('\n')).toContain('(empty)')
  })

  test('does not show TIMED OUT', () => {
    const formatted = formatErrorResult('Error', 100)

    expect(formatted).not.toContain('**TIMED OUT**')
  })
})

// =============================================================================
// formatNoCodeError
// =============================================================================

describe('formatNoCodeError', () => {
  test('returns error for no code provided', () => {
    const formatted = formatNoCodeError()

    expect(formatted).toContain('## Execution Result')
    expect(formatted).toContain('**Exit Code:** 1')
    expect(formatted).toContain('No code provided')
  })

  test('sets exit code to 1', () => {
    const formatted = formatNoCodeError()

    expect(formatted).toContain('**Exit Code:** 1')
  })

  test('sets duration to 0', () => {
    const formatted = formatNoCodeError()

    expect(formatted).toContain('**Duration:** 0ms')
  })

  test('puts error in stderr section', () => {
    const formatted = formatNoCodeError()

    expect(formatted).toContain('### stderr')
    expect(formatted).toContain('No code provided')
  })

  test('does not include runtime', () => {
    const formatted = formatNoCodeError()

    expect(formatted).not.toContain('**Runtime:**')
  })

  test('is not timed out', () => {
    const formatted = formatNoCodeError()

    expect(formatted).not.toContain('**TIMED OUT**')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Formatting integration', () => {
  test('formatted output is valid Markdown', () => {
    const result: ExecutionResult = {
      exitCode: 0,
      stdout: 'Hello, World!',
      stderr: 'Warning: deprecated API',
      durationMs: 150,
      timedOut: false,
      runtime: 'node',
    }

    const formatted = formatExecutionResult(result)

    // Check basic Markdown structure
    expect(formatted).toMatch(/^## /m) // Starts with H2
    expect(formatted).toMatch(/### stdout/) // Has H3 sections
    expect(formatted).toMatch(/### stderr/)
    expect(formatted).toMatch(/```[\s\S]*```/) // Has code blocks
  })

  test('all formatting functions produce consistent structure', () => {
    const successResult = formatExecutionResult({
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      durationMs: 100,
      timedOut: false,
    })

    const errorResult = formatErrorResult('Error occurred', 50)
    const noCodeResult = formatNoCodeError()

    // All should have the same structure
    for (const result of [successResult, errorResult, noCodeResult]) {
      expect(result).toContain('## Execution Result')
      expect(result).toContain('**Exit Code:**')
      expect(result).toContain('**Duration:**')
      expect(result).toContain('### stdout')
      expect(result).toContain('### stderr')
    }
  })

  test('handles realistic Python output', () => {
    const result: ExecutionResult = {
      exitCode: 0,
      stdout: `Hello from Python!
x = 42
y = [1, 2, 3]
Result: {'key': 'value'}`,
      stderr: '',
      durationMs: 234,
      timedOut: false,
      runtime: 'python',
    }

    const formatted = formatExecutionResult(result)

    expect(formatted).toContain('Hello from Python!')
    expect(formatted).toContain('x = 42')
    expect(formatted).toContain('**Runtime:** python')
  })

  test('handles realistic Node.js error output', () => {
    const result: ExecutionResult = {
      exitCode: 1,
      stdout: '',
      stderr: `TypeError: Cannot read properties of undefined (reading 'map')
    at Object.<anonymous> (/app/index.js:5:10)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)`,
      durationMs: 45,
      timedOut: false,
      runtime: 'node',
    }

    const formatted = formatExecutionResult(result)

    expect(formatted).toContain('TypeError')
    expect(formatted).toContain('at Object.<anonymous>')
    expect(formatted).toContain('**Exit Code:** 1')
  })
})
