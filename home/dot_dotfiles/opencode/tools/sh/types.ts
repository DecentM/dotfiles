/**
 * Type definitions for the sh tool.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Decision = "allow" | "deny";

// =============================================================================
// Constraint Types
// =============================================================================

export type ConstraintType = 'cwd_only' | 'no_recursive' | 'no_force' | 'max_depth' | 'require_flag';

export interface CwdOnlyConstraint {
  type: 'cwd_only';
  also_allow?: string[];
  exclude?: string[];
}

export interface MaxDepthConstraint {
  type: 'max_depth';
  value: number;
}

export interface RequireFlagConstraint {
  type: 'require_flag';
  flag: string;
}

export interface NoRecursiveConstraint {
  type: 'no_recursive';
}

export interface NoForceConstraint {
  type: 'no_force';
}

export type ConstraintConfig =
  | ConstraintType                    // String shorthand: "cwd_only"
  | CwdOnlyConstraint
  | MaxDepthConstraint
  | RequireFlagConstraint
  | NoRecursiveConstraint
  | NoForceConstraint;

export interface ConstraintResult {
  valid: boolean;
  violation?: string;  // Human-readable reason for denial
}

// =============================================================================
// Permission Pattern Types
// =============================================================================

export interface PermissionPattern {
  pattern: string;
  decision: Decision;
  reason?: string;
  constraints?: ConstraintConfig[];
}

/**
 * Compiled permission pattern with pre-built regex for performance.
 */
export interface CompiledPermissionPattern extends PermissionPattern {
  compiledRegex: RegExp;
}

export interface PermissionsConfig {
  rules: CompiledPermissionPattern[];
  default: Decision;
  default_reason: string;
}

export interface MatchResult {
  decision: Decision;
  pattern: string | null;
  reason?: string;
  isDefault?: boolean;
  rule?: PermissionPattern;  // Full rule for constraint checking
}

// =============================================================================
// YAML Types
// =============================================================================

/**
 * Raw rule format from YAML - supports both single pattern and multiple patterns.
 */
export interface YamlRule {
  pattern?: string;
  patterns?: string[];
  decision: string;
  reason?: string | null;
  constraints?: ConstraintConfig[];
}

// =============================================================================
// Logging Types
// =============================================================================

export interface LogEntry {
  sessionId?: string;
  messageId?: string;
  command: string;
  workdir?: string;
  patternMatched: string | null;
  decision: Decision;
  exitCode?: number;
  durationMs?: number;
}
