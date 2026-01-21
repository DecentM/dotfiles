/**
 * Type definitions for the docker tool.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Decision = "allow" | "deny";

// =============================================================================
// Docker Operations
// =============================================================================

export type DockerOperationType =
  // Container operations
  | "container:list"
  | "container:inspect"
  | "container:create"
  | "container:start"
  | "container:stop"
  | "container:remove"
  | "container:logs"
  | "container:exec"
  // Image operations
  | "image:list"
  | "image:pull"
  | "image:inspect"
  | "image:remove"
  // Volume operations
  | "volume:list"
  | "volume:create"
  | "volume:remove"
  // Network operations
  | "network:list";

/**
 * Full operation pattern with target, e.g., "container:create:node:20"
 */
export type OperationPattern = string;

// =============================================================================
// Constraint Types
// =============================================================================

export type ConstraintType =
  | "no_privileged"
  | "no_host_network"
  | "allowed_mounts"
  | "image_pattern"
  | "container_pattern"
  | "resource_limits";

export interface NoPrivilegedConstraint {
  type: "no_privileged";
}

export interface NoHostNetworkConstraint {
  type: "no_host_network";
}

export interface AllowedMountsConstraint {
  type: "allowed_mounts";
  value: string[];
}

export interface ImagePatternConstraint {
  type: "image_pattern";
  value: string[];
}

export interface ContainerPatternConstraint {
  type: "container_pattern";
  value: string[];
}

export interface ResourceLimitsConstraint {
  type: "resource_limits";
  max_memory?: string; // e.g., "512m", "1g"
  max_cpus?: number; // e.g., 1, 2
}

export type ConstraintConfig =
  | ConstraintType // String shorthand: "no_privileged"
  | NoPrivilegedConstraint
  | NoHostNetworkConstraint
  | AllowedMountsConstraint
  | ImagePatternConstraint
  | ContainerPatternConstraint
  | ResourceLimitsConstraint;

export interface ConstraintResult {
  valid: boolean;
  violation?: string; // Human-readable reason for denial
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
  rule?: PermissionPattern; // Full rule for constraint checking
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
// Docker API Types
// =============================================================================

export interface ContainerConfig {
  Image: string;
  Cmd?: string[];
  Env?: string[];
  WorkingDir?: string;
  User?: string;
  HostConfig?: HostConfig;
  NetworkingConfig?: NetworkingConfig;
  Labels?: Record<string, string>;
  Tty?: boolean;
  OpenStdin?: boolean;
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
}

export interface HostConfig {
  Binds?: string[];
  Memory?: number;
  NanoCpus?: number;
  Privileged?: boolean;
  NetworkMode?: string;
  PortBindings?: Record<string, Array<{ HostPort: string }>>;
  AutoRemove?: boolean;
  RestartPolicy?: {
    Name: string;
    MaximumRetryCount?: number;
  };
}

export interface NetworkingConfig {
  EndpointsConfig?: Record<string, object>;
}

export interface ExecConfig {
  Cmd: string[];
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
  Tty?: boolean;
  Env?: string[];
  WorkingDir?: string;
  User?: string;
}

// =============================================================================
// Logging Types
// =============================================================================

export interface LogEntry {
  sessionId?: string;
  messageId?: string;
  operation: string;
  target?: string;
  paramsJson?: string;
  patternMatched: string | null;
  decision: Decision;
  resultSummary?: string;
  durationMs?: number;
}
