/**
 * Type definitions for the sh tool.
 */

import type {
  CompiledPermissionPattern as BaseCompiledPermissionPattern,
  ConstraintResult as BaseConstraintResult,
  Decision as BaseDecision,
  MatchResult as BaseMatchResult,
  PermissionPattern as BasePermissionPattern,
  PermissionsConfig as BasePermissionsConfig,
  YamlRule as BaseYamlRule,
} from '../../lib/permissions'

// =============================================================================
// Core Types (re-exported from shared library)
// =============================================================================

export type Decision = BaseDecision
export type ConstraintResult = BaseConstraintResult

// =============================================================================
// Constraint Types (sh-specific)
// =============================================================================

export type ConstraintType = 'cwd_only' | 'no_recursive' | 'no_force' | 'max_depth' | 'require_flag'

export interface CwdOnlyConstraint {
  type: 'cwd_only'
  also_allow?: string[]
  exclude?: string[]
}

export interface MaxDepthConstraint {
  type: 'max_depth'
  value: number
}

export interface RequireFlagConstraint {
  type: 'require_flag'
  flag: string
}

export interface NoRecursiveConstraint {
  type: 'no_recursive'
}

export interface NoForceConstraint {
  type: 'no_force'
}

export type ConstraintConfig =
  | ConstraintType // String shorthand: "cwd_only"
  | CwdOnlyConstraint
  | MaxDepthConstraint
  | RequireFlagConstraint
  | NoRecursiveConstraint
  | NoForceConstraint

// =============================================================================
// Permission Pattern Types (specialized from shared library)
// =============================================================================

export type PermissionPattern = BasePermissionPattern<ConstraintConfig>
export type CompiledPermissionPattern = BaseCompiledPermissionPattern<ConstraintConfig>
export type PermissionsConfig = BasePermissionsConfig<ConstraintConfig>
export type MatchResult = BaseMatchResult<ConstraintConfig>
export type YamlRule = BaseYamlRule<ConstraintConfig>

// =============================================================================
// Logging Types
// =============================================================================

export interface LogEntry {
  sessionId?: string
  messageId?: string
  command: string
  workdir?: string
  patternMatched: string | null
  decision: Decision
  exitCode?: number
  durationMs?: number
}
