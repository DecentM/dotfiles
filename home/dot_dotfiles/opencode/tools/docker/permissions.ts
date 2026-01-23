/**
 * Permission loading and operation matching for the docker tool.
 */

import { join } from 'node:path'
import {
  createPatternMatcher,
  createPermissionLoader,
  simplePatternToRegex,
} from '../../lib/permissions'
import type { ConstraintConfig, MatchResult, PermissionsConfig } from './types'
import { validateYamlConfig } from './validators'

// =============================================================================
// Permission Loading
// =============================================================================

/**
 * Load permissions from YAML file.
 * Uses a singleton pattern to load only once.
 * Pre-compiles regexes for performance.
 *
 * Supports two rule formats:
 * 1. Single pattern:  { pattern: "container:list", decision: "allow" }
 * 2. Multi-pattern:   { patterns: ["container:list", "image:list"], decision: "allow" }
 */
export const getPermissions: () => PermissionsConfig = createPermissionLoader<ConstraintConfig>({
  yamlPath: join(import.meta.dir, 'docker-permissions.yaml'),
  patternToRegex: simplePatternToRegex,
  validateConfig: validateYamlConfig,
  fallbackDefault: 'deny',
  fallbackDefaultReason: 'Permissions file failed to load - all operations denied for safety',
  logPrefix: '[docker]',
})

// =============================================================================
// Operation Matching
// =============================================================================

/**
 * Build an operation pattern string from operation type and target.
 * Examples:
 *   - container:list
 *   - container:create:node:20
 *   - image:pull:ubuntu:22.04
 */
export const buildOperationPattern = (operation: string, target?: string): string => {
  if (!target) return operation
  return `${operation}:${target}`
}

/**
 * Find the first matching permission pattern for an operation.
 * Uses pre-compiled regexes for performance.
 */
export const matchOperation: (operationPattern: string) => MatchResult =
  createPatternMatcher<ConstraintConfig>(getPermissions)
