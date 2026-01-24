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
  MatchResultWithTrace,
  PermissionPattern,
  PermissionsConfig,
  TraceEntry,
  YamlRule,
} from './types'

// Validators
export {
  createPatternMatcher,
  createPatternMatcherWithTrace,
  simplePatternToRegex,
  validateYamlConfig,
  validateYamlRule,
} from './validators'
