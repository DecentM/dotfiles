/**
 * Pattern matching and validation utilities for the shared permissions library.
 */

import type { MatchResult, MatchResultWithTrace, PermissionsConfig, TraceEntry } from './types'

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Convert a simple glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 * This is the basic implementation - tools may provide custom implementations.
 */
export const simplePatternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Create a pattern matcher function.
 * Uses pre-compiled regexes for performance.
 *
 * @template TConstraint - The constraint configuration type
 * @param getPermissions - Function that returns the permissions config
 * @returns A function that matches an input against permission patterns
 */
export const createPatternMatcher = <TConstraint>(
  getPermissions: () => PermissionsConfig<TConstraint>
): ((input: string) => MatchResult<TConstraint>) => {
  return (input: string): MatchResult<TConstraint> => {
    const config = getPermissions()

    for (const perm of config.rules) {
      if (perm.compiledRegex.test(input)) {
        return {
          decision: perm.decision,
          pattern: perm.pattern,
          reason: perm.reason,
          rule: perm,
        }
      }
    }

    // Default: use config default (typically deny) if no pattern matches
    return {
      decision: config.default,
      pattern: null,
      reason: config.default_reason,
      isDefault: true,
    }
  }
}

/**
 * Create a pattern matcher function with full trace output.
 * Records every pattern checked in a trace array for debugging.
 *
 * @template TConstraint - The constraint configuration type
 * @param getPermissions - Function that returns the permissions config
 * @returns A function that matches an input and returns trace of all patterns checked
 */
export const createPatternMatcherWithTrace = <TConstraint>(
  getPermissions: () => PermissionsConfig<TConstraint>
): ((input: string) => MatchResultWithTrace<TConstraint>) => {
  return (input: string): MatchResultWithTrace<TConstraint> => {
    const config = getPermissions()
    const trace: TraceEntry<TConstraint>[] = []

    for (let i = 0; i < config.rules.length; i++) {
      const perm = config.rules[i]
      const matched = perm.compiledRegex.test(input)

      trace.push({
        index: i,
        pattern: perm.pattern,
        compiledRegex: perm.compiledRegex,
        decision: perm.decision,
        reason: perm.reason,
        matched,
      })

      if (matched) {
        return {
          decision: perm.decision,
          pattern: perm.pattern,
          reason: perm.reason,
          rule: perm,
          trace,
        }
      }
    }

    // Default: use config default (typically deny) if no pattern matches
    return {
      decision: config.default,
      pattern: null,
      reason: config.default_reason,
      isDefault: true,
      trace,
    }
  }
}

// =============================================================================
// YAML Validation Utilities
// =============================================================================

/**
 * Validate a single YAML rule structure.
 * This validates the common fields - tool-specific constraint validation
 * should be provided separately.
 *
 * @param rule - The rule to validate
 * @param index - The rule index for error messages
 * @param validateConstraints - Optional function to validate constraints
 * @returns Error message if invalid, undefined if valid
 */
export const validateYamlRule = <TConstraint>(
  rule: unknown,
  index: number,
  validateConstraints?: (constraints: unknown[], ruleIndex: number) => string | undefined
): string | undefined => {
  if (typeof rule !== 'object' || rule === null) {
    return `Rule ${index}: Must be an object`
  }

  const r = rule as Record<string, unknown>

  // Must have pattern or patterns
  const hasPattern = typeof r.pattern === 'string'
  const hasPatterns = Array.isArray(r.patterns) && r.patterns.every((p) => typeof p === 'string')
  if (!hasPattern && !hasPatterns) {
    return `Rule ${index}: Must have 'pattern' (string) or 'patterns' (string array)`
  }

  // Must have valid decision
  if (r.decision !== 'allow' && r.decision !== 'deny') {
    return `Rule ${index}: 'decision' must be 'allow' or 'deny'`
  }

  // Reason is optional but must be string or null
  if (r.reason !== undefined && r.reason !== null && typeof r.reason !== 'string') {
    return `Rule ${index}: 'reason' must be a string or null`
  }

  // Validate constraints array if provided
  if (r.constraints !== undefined) {
    if (!Array.isArray(r.constraints)) {
      return `Rule ${index}: 'constraints' must be an array`
    }
    if (validateConstraints) {
      const constraintError = validateConstraints(r.constraints, index)
      if (constraintError) return constraintError
    }
  }

  return undefined
}

/**
 * Validate the entire YAML config structure.
 *
 * @param parsed - The parsed YAML content
 * @param validateConstraints - Optional function to validate constraints
 * @returns Array of error messages (empty if valid)
 */
export const validateYamlConfig = <TConstraint>(
  parsed: unknown,
  validateConstraints?: (constraints: unknown[], ruleIndex: number) => string | undefined
): string[] => {
  const errors: string[] = []

  if (typeof parsed !== 'object' || parsed === null) {
    return ['Config must be an object']
  }

  const config = parsed as Record<string, unknown>

  if (!Array.isArray(config.rules)) {
    return ['Config must have a "rules" array']
  }

  for (let i = 0; i < config.rules.length; i++) {
    const err = validateYamlRule<TConstraint>(config.rules[i], i, validateConstraints)
    if (err) errors.push(err)
  }

  if (config.default !== undefined && config.default !== 'allow' && config.default !== 'deny') {
    errors.push("'default' must be 'allow' or 'deny'")
  }

  if (config.default_reason !== undefined && typeof config.default_reason !== 'string') {
    errors.push("'default_reason' must be a string")
  }

  return errors
}
