/**
 * Generic type definitions for the shared permissions library.
 * Tool-specific constraint types should extend BaseConstraintConfig.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Decision = 'allow' | 'deny'

// =============================================================================
// Constraint Types
// =============================================================================

/**
 * Result of validating a constraint.
 */
export interface ConstraintResult {
  valid: boolean
  violation?: string // Human-readable reason for denial
}

/**
 * Base interface for constraint configurations.
 * Tool-specific constraints should extend this.
 */
export interface BaseConstraintConfig {
  type: string
}

/**
 * Function type for constraint validators.
 * @template TConstraint - The constraint configuration type
 * @template TContext - The context passed to validators (e.g., command string, container config)
 */
export type ConstraintValidator<TConstraint, TContext> = (
  constraint: TConstraint,
  context: TContext
) => ConstraintResult

// =============================================================================
// Permission Pattern Types
// =============================================================================

/**
 * A permission pattern with optional constraints.
 * @template TConstraint - The constraint configuration type
 */
export interface PermissionPattern<TConstraint> {
  pattern: string
  decision: Decision
  reason?: string
  constraints?: TConstraint[]
}

/**
 * Compiled permission pattern with pre-built regex for performance.
 * @template TConstraint - The constraint configuration type
 */
export interface CompiledPermissionPattern<TConstraint> extends PermissionPattern<TConstraint> {
  compiledRegex: RegExp
}

/**
 * Configuration loaded from YAML.
 * @template TConstraint - The constraint configuration type
 */
export interface PermissionsConfig<TConstraint> {
  rules: CompiledPermissionPattern<TConstraint>[]
  default: Decision
  default_reason: string
}

/**
 * Result of matching against permission patterns.
 * @template TConstraint - The constraint configuration type
 */
export interface MatchResult<TConstraint> {
  decision: Decision
  pattern: string | null
  reason?: string
  isDefault?: boolean
  rule?: PermissionPattern<TConstraint> // Full rule for constraint checking
}

// =============================================================================
// YAML Types
// =============================================================================

/**
 * Raw rule format from YAML - supports both single pattern and multiple patterns.
 * @template TConstraint - The constraint configuration type
 */
export interface YamlRule<TConstraint> {
  pattern?: string
  patterns?: string[]
  decision: string
  reason?: string | null
  constraints?: TConstraint[]
}
