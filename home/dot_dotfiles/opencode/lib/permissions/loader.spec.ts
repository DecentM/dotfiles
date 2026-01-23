/**
 * Tests for the shared permissions loader module.
 * Tests YAML loading, regex compilation, and singleton behavior.
 *
 * Note: These tests verify the loader factory logic.
 * File system operations are tested via the actual YAML files when available.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPermissionLoader, type LoaderOptions } from './loader'
import type { PermissionsConfig } from './types'
import { simplePatternToRegex, validateYamlConfig } from './validators'

// =============================================================================
// Test Helpers
// =============================================================================

interface TestConstraint {
  type: string
  value?: string | string[]
}

const createTestLoader = (
  yamlPath: string,
  options?: Partial<LoaderOptions>
): (() => PermissionsConfig<TestConstraint>) => {
  return createPermissionLoader<TestConstraint>({
    yamlPath,
    patternToRegex: simplePatternToRegex,
    validateConfig: (parsed) => validateYamlConfig(parsed),
    logPrefix: '[test]',
    ...options,
  })
}

// Create a temporary directory for test files
const getTempDir = (): string => {
  const dir = join(tmpdir(), `permissions-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// =============================================================================
// createPermissionLoader - Factory Behavior
// =============================================================================

describe('createPermissionLoader', () => {
  let tempDir: string
  let consoleSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tempDir = getTempDir()
    consoleSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    consoleSpy.mockRestore()
  })

  describe('successful loading', () => {
    test('parses valid YAML and returns config', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "echo*"
    decision: allow
    reason: Allow echo commands
  - pattern: "rm*"
    decision: deny
    reason: No deletes
default: deny
default_reason: Not in allowlist
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules.length).toBe(2)
      expect(config.default).toBe('deny')
      expect(config.default_reason).toBe('Not in allowlist')
    })

    test('compiles patterns to regex', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "cat*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].compiledRegex).toBeDefined()
      expect(config.rules[0].compiledRegex.test('cat file.txt')).toBe(true)
      expect(config.rules[0].compiledRegex.test('dog file.txt')).toBe(false)
    })

    test('preserves reason from YAML', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "test*"
    decision: allow
    reason: Testing allowed
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].reason).toBe('Testing allowed')
    })

    test('handles null reason', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "test*"
    decision: allow
    reason: null
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].reason).toBeUndefined()
    })

    test('preserves constraints from YAML', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "cat*"
    decision: allow
    constraints:
      - type: cwd_only
        value: ["/tmp"]
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].constraints).toEqual([{ type: 'cwd_only', value: ['/tmp'] }])
    })

    test('uses config default when specified', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "rm*"
    decision: deny
default: allow
default_reason: Everything allowed by default
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.default).toBe('allow')
      expect(config.default_reason).toBe('Everything allowed by default')
    })

    test('uses fallback default when not in config', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "echo*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath, {
        fallbackDefault: 'allow',
        fallbackDefaultReason: 'Fallback reason',
      })
      const config = getPermissions()

      // fallbackDefault is used when config doesn't specify default
      expect(config.default).toBe('allow')
    })
  })

  describe('singleton behavior', () => {
    test('caches config after first load', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "echo*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)

      // First call loads
      const config1 = getPermissions()
      expect(config1.rules.length).toBe(1)

      // Modify file (shouldn't affect cached result)
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "cat*"
    decision: deny
  - pattern: "ls*"
    decision: allow
`
      )

      // Second call returns cached config
      const config2 = getPermissions()
      expect(config2.rules.length).toBe(1) // Still 1, not 2
      expect(config2.rules[0].pattern).toBe('echo*')
    })

    test('returns same object reference', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "test*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config1 = getPermissions()
      const config2 = getPermissions()

      expect(config1).toBe(config2) // Same reference
    })

    test('different loaders have independent caches', () => {
      const yamlPath1 = join(tempDir, 'permissions1.yaml')
      const yamlPath2 = join(tempDir, 'permissions2.yaml')

      writeFileSync(
        yamlPath1,
        `
rules:
  - pattern: "loader1*"
    decision: allow
`
      )
      writeFileSync(
        yamlPath2,
        `
rules:
  - pattern: "loader2*"
    decision: deny
`
      )

      const getPermissions1 = createTestLoader(yamlPath1)
      const getPermissions2 = createTestLoader(yamlPath2)

      const config1 = getPermissions1()
      const config2 = getPermissions2()

      expect(config1.rules[0].pattern).toBe('loader1*')
      expect(config2.rules[0].pattern).toBe('loader2*')
    })
  })

  describe('pattern expansion', () => {
    test('expands patterns array into individual rules', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - patterns:
      - "ls*"
      - "cat*"
      - "echo*"
    decision: allow
    reason: Basic commands
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules.length).toBe(3)
      expect(config.rules[0].pattern).toBe('ls*')
      expect(config.rules[1].pattern).toBe('cat*')
      expect(config.rules[2].pattern).toBe('echo*')

      // All should have same decision and reason
      for (const rule of config.rules) {
        expect(rule.decision).toBe('allow')
        expect(rule.reason).toBe('Basic commands')
      }
    })

    test('expanded rules each get compiled regex', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - patterns:
      - "ls*"
      - "cat*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].compiledRegex.test('ls -la')).toBe(true)
      expect(config.rules[0].compiledRegex.test('cat file')).toBe(false)

      expect(config.rules[1].compiledRegex.test('cat file')).toBe(true)
      expect(config.rules[1].compiledRegex.test('ls -la')).toBe(false)
    })

    test('expanded rules share constraints', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - patterns:
      - "cat*"
      - "head*"
    decision: allow
    constraints:
      - type: cwd_only
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].constraints).toEqual([{ type: 'cwd_only' }])
      expect(config.rules[1].constraints).toEqual([{ type: 'cwd_only' }])
    })

    test('handles single pattern field (not patterns array)', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "single*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules.length).toBe(1)
      expect(config.rules[0].pattern).toBe('single*')
    })

    test('mixes single pattern and patterns array rules', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      const yamlContent = `
rules:
  - pattern: "single*"
    decision: allow
  - patterns:
      - "multi1*"
      - "multi2*"
    decision: deny
  - pattern: "another*"
    decision: allow
`
      writeFileSync(yamlPath, yamlContent)

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules.length).toBe(4)
      expect(config.rules.map((r) => r.pattern)).toEqual([
        'single*',
        'multi1*',
        'multi2*',
        'another*',
      ])
    })
  })

  describe('error handling - missing file', () => {
    test('returns fallback config when file not found', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createTestLoader(yamlPath, {
        fallbackDefault: 'deny',
        fallbackDefaultReason: 'File not found fallback',
      })
      const config = getPermissions()

      expect(config.rules).toEqual([])
      expect(config.default).toBe('deny')
    })

    test('logs error when file not found', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createTestLoader(yamlPath)
      getPermissions()

      expect(consoleSpy).toHaveBeenCalled()
      const errorCall = consoleSpy.mock.calls[0]
      expect(errorCall[0]).toContain('[test]')
      expect(errorCall[0]).toContain('Failed to load permissions')
    })

    test('caches fallback config after error', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createTestLoader(yamlPath)

      // First call - logs error
      getPermissions()
      expect(consoleSpy).toHaveBeenCalledTimes(1)

      // Second call - uses cached fallback (no additional error)
      getPermissions()
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling - invalid YAML', () => {
    test('returns fallback config for malformed YAML', () => {
      const yamlPath = join(tempDir, 'invalid.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "test
    unclosed: [string
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules).toEqual([])
      expect(config.default).toBe('deny')
    })

    test('logs error for malformed YAML', () => {
      const yamlPath = join(tempDir, 'invalid.yaml')
      writeFileSync(yamlPath, 'not: [valid: yaml')

      const getPermissions = createTestLoader(yamlPath)
      getPermissions()

      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('error handling - validation failures', () => {
    test('returns fallback config when validation fails', () => {
      const yamlPath = join(tempDir, 'invalid-structure.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "test*"
    decision: maybe
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules).toEqual([])
      expect(config.default).toBe('deny')
    })

    test('logs validation errors', () => {
      const yamlPath = join(tempDir, 'invalid-structure.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "test*"
    decision: invalid
`
      )

      const getPermissions = createTestLoader(yamlPath)
      getPermissions()

      expect(consoleSpy).toHaveBeenCalled()
      const calls = consoleSpy.mock.calls
      expect(calls.some((c: string[]) => c[0].includes('Invalid permissions YAML'))).toBe(true)
    })

    test('logs each validation error individually', () => {
      const yamlPath = join(tempDir, 'multiple-errors.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - decision: allow
  - pattern: 123
    decision: deny
default: maybe
`
      )

      const getPermissions = createTestLoader(yamlPath)
      getPermissions()

      // Should have logged the header and individual errors
      expect(consoleSpy.mock.calls.length).toBeGreaterThan(1)
    })

    test('returns fallback when rules is not array', () => {
      const yamlPath = join(tempDir, 'bad-rules.yaml')
      writeFileSync(
        yamlPath,
        `
rules: "not an array"
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules).toEqual([])
    })
  })

  describe('fallback configuration', () => {
    test('uses default fallbackDefault of deny', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createPermissionLoader<TestConstraint>({
        yamlPath,
        patternToRegex: simplePatternToRegex,
        validateConfig: (parsed) => validateYamlConfig(parsed),
        logPrefix: '[test]',
        // No fallbackDefault specified
      })
      const config = getPermissions()

      expect(config.default).toBe('deny')
    })

    test('uses custom fallbackDefault', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createTestLoader(yamlPath, {
        fallbackDefault: 'allow',
      })
      const config = getPermissions()

      expect(config.default).toBe('allow')
    })

    test('uses default fallbackDefaultReason', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createPermissionLoader<TestConstraint>({
        yamlPath,
        patternToRegex: simplePatternToRegex,
        validateConfig: (parsed) => validateYamlConfig(parsed),
        logPrefix: '[test]',
        // No fallbackDefaultReason specified
      })
      const config = getPermissions()

      expect(config.default_reason).toContain('failed to load')
    })

    test('uses custom fallbackDefaultReason', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createTestLoader(yamlPath, {
        fallbackDefaultReason: 'Custom fallback reason',
      })
      const config = getPermissions()

      expect(config.default_reason).toBe('Custom fallback reason')
    })
  })

  describe('custom patternToRegex', () => {
    test('uses provided patternToRegex function', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "exact-match"
    decision: allow
`
      )

      // Custom function that requires exact match (no wildcards)
      const exactMatchRegex = (pattern: string): RegExp => {
        return new RegExp(`^${pattern}$`)
      }

      const getPermissions = createPermissionLoader<TestConstraint>({
        yamlPath,
        patternToRegex: exactMatchRegex,
        validateConfig: (parsed) => validateYamlConfig(parsed),
        logPrefix: '[test]',
      })
      const config = getPermissions()

      // Without case-insensitive flag from simplePatternToRegex
      expect(config.rules[0].compiledRegex.test('exact-match')).toBe(true)
      expect(config.rules[0].compiledRegex.test('EXACT-MATCH')).toBe(false)
    })
  })

  describe('custom validateConfig', () => {
    test('uses provided validateConfig function', () => {
      const yamlPath = join(tempDir, 'permissions.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "test*"
    decision: allow
    constraints:
      - type: custom_constraint
`
      )

      // Custom validator that rejects 'custom_constraint'
      const customValidator = (parsed: unknown): string[] => {
        const baseErrors = validateYamlConfig(parsed)
        if (baseErrors.length > 0) return baseErrors

        const config = parsed as {
          rules: Array<{ constraints?: Array<{ type: string }> }>
        }
        for (let i = 0; i < config.rules.length; i++) {
          const constraints = config.rules[i].constraints ?? []
          for (const c of constraints) {
            if (c.type === 'custom_constraint') {
              return [`Rule ${i}: custom_constraint is not supported`]
            }
          }
        }
        return []
      }

      const getPermissions = createPermissionLoader<TestConstraint>({
        yamlPath,
        patternToRegex: simplePatternToRegex,
        validateConfig: customValidator,
        logPrefix: '[test]',
      })
      const config = getPermissions()

      // Should fall back due to validation error
      expect(config.rules).toEqual([])
    })
  })

  describe('logPrefix', () => {
    test('includes logPrefix in error messages', () => {
      const yamlPath = join(tempDir, 'nonexistent.yaml')

      const getPermissions = createPermissionLoader<TestConstraint>({
        yamlPath,
        patternToRegex: simplePatternToRegex,
        validateConfig: (parsed) => validateYamlConfig(parsed),
        logPrefix: '[my-tool]',
      })
      getPermissions()

      const errorCall = consoleSpy.mock.calls[0]
      expect(errorCall[0]).toContain('[my-tool]')
    })
  })

  describe('edge cases', () => {
    test('handles empty rules array', () => {
      const yamlPath = join(tempDir, 'empty-rules.yaml')
      writeFileSync(
        yamlPath,
        `
rules: []
default: allow
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules).toEqual([])
      expect(config.default).toBe('allow')
    })

    test('handles rules with empty patterns array', () => {
      const yamlPath = join(tempDir, 'empty-patterns.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - patterns: []
    decision: allow
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      // Empty patterns array = no rules generated
      expect(config.rules.length).toBe(0)
    })

    test('handles unicode in patterns', () => {
      const yamlPath = join(tempDir, 'unicode.yaml')
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "echo 你好*"
    decision: allow
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].compiledRegex.test('echo 你好世界')).toBe(true)
    })

    test('handles very long patterns', () => {
      const yamlPath = join(tempDir, 'long-pattern.yaml')
      const longPattern = 'prefix' + 'a'.repeat(1000) + '*'
      writeFileSync(
        yamlPath,
        `
rules:
  - pattern: "${longPattern}"
    decision: allow
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules[0].pattern).toBe(longPattern)
      expect(config.rules[0].compiledRegex.test('prefix' + 'a'.repeat(1000) + 'suffix')).toBe(true)
    })

    test('handles YAML with comments', () => {
      const yamlPath = join(tempDir, 'with-comments.yaml')
      writeFileSync(
        yamlPath,
        `
# This is a comment
rules:
  # Allow echo commands
  - pattern: "echo*"  # inline comment
    decision: allow
    reason: "Echo is safe"

# Default policy
default: deny  # strict by default
default_reason: "Not in allowlist"
`
      )

      const getPermissions = createTestLoader(yamlPath)
      const config = getPermissions()

      expect(config.rules.length).toBe(1)
      expect(config.rules[0].pattern).toBe('echo*')
      expect(config.default).toBe('deny')
    })
  })
})
