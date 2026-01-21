/**
 * Type definitions for the docker tool.
 */

import type {
	CompiledPermissionPattern as BaseCompiledPermissionPattern,
	ConstraintResult as BaseConstraintResult,
	Decision as BaseDecision,
	MatchResult as BaseMatchResult,
	PermissionPattern as BasePermissionPattern,
	PermissionsConfig as BasePermissionsConfig,
	YamlRule as BaseYamlRule,
} from "../../lib/permissions";

// Re-export Docker API types from lib/docker (source of truth)
export type {
	ContainerConfig,
	ExecConfig,
	HostConfig,
	NetworkingConfig,
} from "../../lib/docker/types";

// =============================================================================
// Core Types (re-exported from shared library)
// =============================================================================

export type Decision = BaseDecision;
export type ConstraintResult = BaseConstraintResult;

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
// Constraint Types (docker-specific)
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

// =============================================================================
// Permission Pattern Types (specialized from shared library)
// =============================================================================

export type PermissionPattern = BasePermissionPattern<ConstraintConfig>;
export type CompiledPermissionPattern =
	BaseCompiledPermissionPattern<ConstraintConfig>;
export type PermissionsConfig = BasePermissionsConfig<ConstraintConfig>;
export type MatchResult = BaseMatchResult<ConstraintConfig>;
export type YamlRule = BaseYamlRule<ConstraintConfig>;

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
