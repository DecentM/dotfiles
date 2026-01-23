/**
 * Shared permissions library.
 * Provides generic types and utilities for YAML-based permission systems.
 */

// Loader
export type { LoaderOptions } from './loader'
export { createPermissionLoader } from './loader'
// Core types
export type {
  BaseConstraintConfig,
  CompiledPermissionPattern,
  ConstraintResult,
  ConstraintValidator,
  Decision,
  MatchResult,
  PermissionPattern,
  PermissionsConfig,
  YamlRule,
} from './types'

// Validators
export {
  createPatternMatcher,
  simplePatternToRegex,
  validateYamlConfig,
  validateYamlRule,
} from './validators'
