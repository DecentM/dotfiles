/**
 * Constraint validators for the docker tool.
 */

import {
	validateYamlConfig as baseValidateYamlConfig,
	simplePatternToRegex,
} from "../../lib/permissions";
import type {
	ConstraintConfig,
	ConstraintResult,
	ConstraintType,
	ContainerConfig,
	PermissionPattern,
} from "./types";

// =============================================================================
// Pattern Matching Utilities
// =============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 */
export const patternToRegex = simplePatternToRegex;

/**
 * Check if a value matches any of the given glob patterns.
 */
export const matchesAnyPattern = (
	value: string,
	patterns: string[],
): boolean => {
	for (const pattern of patterns) {
		if (patternToRegex(pattern).test(value)) {
			return true;
		}
	}
	return false;
};

// =============================================================================
// YAML Schema Validation
// =============================================================================

/**
 * Validate a constraint configuration.
 * Returns an error message if invalid, undefined if valid.
 */
export const validateConstraint = (
	c: unknown,
	index: number,
	ruleIndex: number,
): string | undefined => {
	if (typeof c === "string") {
		const validTypes: ConstraintType[] = [
			"no_privileged",
			"no_host_network",
			"allowed_mounts",
			"image_pattern",
			"container_pattern",
			"resource_limits",
		];
		if (!validTypes.includes(c as ConstraintType)) {
			return `Rule ${ruleIndex}: Invalid constraint type '${c}'`;
		}
		// String shorthand for constraints with values is invalid
		if (
			c === "allowed_mounts" ||
			c === "image_pattern" ||
			c === "container_pattern" ||
			c === "resource_limits"
		) {
			return `Rule ${ruleIndex}: Constraint '${c}' requires object form with parameters`;
		}
		return undefined;
	}

	if (typeof c !== "object" || c === null) {
		return `Rule ${ruleIndex}: Constraint ${index} must be a string or object`;
	}

	const obj = c as Record<string, unknown>;
	if (typeof obj.type !== "string") {
		return `Rule ${ruleIndex}: Constraint ${index} missing 'type' field`;
	}

	switch (obj.type) {
		case "no_privileged":
		case "no_host_network":
			break;
		case "allowed_mounts":
			if (
				!Array.isArray(obj.value) ||
				!obj.value.every((v) => typeof v === "string")
			) {
				return `Rule ${ruleIndex}: allowed_mounts requires 'value' as string array`;
			}
			break;
		case "image_pattern":
			if (
				!Array.isArray(obj.value) ||
				!obj.value.every((v) => typeof v === "string")
			) {
				return `Rule ${ruleIndex}: image_pattern requires 'value' as string array`;
			}
			break;
		case "container_pattern":
			if (
				!Array.isArray(obj.value) ||
				!obj.value.every((v) => typeof v === "string")
			) {
				return `Rule ${ruleIndex}: container_pattern requires 'value' as string array`;
			}
			break;
		case "resource_limits":
			if (obj.max_memory !== undefined && typeof obj.max_memory !== "string") {
				return `Rule ${ruleIndex}: resource_limits.max_memory must be a string (e.g., '512m')`;
			}
			if (obj.max_cpus !== undefined && typeof obj.max_cpus !== "number") {
				return `Rule ${ruleIndex}: resource_limits.max_cpus must be a number`;
			}
			break;
		default:
			return `Rule ${ruleIndex}: Unknown constraint type '${obj.type}'`;
	}

	return undefined;
};

/**
 * Validate constraints array for a rule.
 * Returns an error message if invalid, undefined if valid.
 */
const validateConstraintsArray = (
	constraints: unknown[],
	ruleIndex: number,
): string | undefined => {
	for (let i = 0; i < constraints.length; i++) {
		const err = validateConstraint(constraints[i], i, ruleIndex);
		if (err) return err;
	}
	return undefined;
};

/**
 * Validate a single YAML rule.
 * Returns an error message if invalid, undefined if valid.
 */
export const validateYamlRule = (
	rule: unknown,
	index: number,
): string | undefined => {
	if (typeof rule !== "object" || rule === null) {
		return `Rule ${index}: Must be an object`;
	}

	const r = rule as Record<string, unknown>;

	// Must have pattern or patterns
	const hasPattern = typeof r.pattern === "string";
	const hasPatterns =
		Array.isArray(r.patterns) && r.patterns.every((p) => typeof p === "string");
	if (!hasPattern && !hasPatterns) {
		return `Rule ${index}: Must have 'pattern' (string) or 'patterns' (string array)`;
	}

	// Must have valid decision
	if (r.decision !== "allow" && r.decision !== "deny") {
		return `Rule ${index}: 'decision' must be 'allow' or 'deny'`;
	}

	// Reason is optional but must be string or null
	if (
		r.reason !== undefined &&
		r.reason !== null &&
		typeof r.reason !== "string"
	) {
		return `Rule ${index}: 'reason' must be a string or null`;
	}

	// Validate constraints array
	if (r.constraints !== undefined) {
		if (!Array.isArray(r.constraints)) {
			return `Rule ${index}: 'constraints' must be an array`;
		}
		for (let i = 0; i < r.constraints.length; i++) {
			const err = validateConstraint(r.constraints[i], i, index);
			if (err) return err;
		}
	}

	return undefined;
};

/**
 * Validate the entire YAML config structure.
 * Returns array of error messages (empty if valid).
 */
export const validateYamlConfig = (parsed: unknown): string[] => {
	return baseValidateYamlConfig<ConstraintConfig>(
		parsed,
		validateConstraintsArray,
	);
};

// =============================================================================
// Constraint Validators
// =============================================================================

/**
 * Validate that container config doesn't request privileged mode.
 */
export const validateNoPrivileged = (
	config: ContainerConfig,
): ConstraintResult => {
	if (config.HostConfig?.Privileged === true) {
		return {
			valid: false,
			violation: "Operation denied: Privileged containers are not allowed",
		};
	}
	return { valid: true };
};

/**
 * Validate that container config doesn't use host network mode.
 */
export const validateNoHostNetwork = (
	config: ContainerConfig,
): ConstraintResult => {
	if (config.HostConfig?.NetworkMode === "host") {
		return {
			valid: false,
			violation: "Operation denied: Host network mode is not allowed",
		};
	}
	return { valid: true };
};

/**
 * Validate that all volume mounts match allowed patterns.
 */
export const validateAllowedMounts = (
	config: ContainerConfig,
	allowedPatterns: string[],
): ConstraintResult => {
	const binds = config.HostConfig?.Binds ?? [];

	for (const bind of binds) {
		// Parse bind mount: "source:dest" or "source:dest:options"
		const parts = bind.split(":");
		const source = parts[0];

		// Check if source matches any allowed pattern
		if (!matchesAnyPattern(source, allowedPatterns)) {
			return {
				valid: false,
				violation: `Operation denied: Mount source '${source}' not in allowed paths. Allowed: ${allowedPatterns.join(", ")}`,
			};
		}
	}

	return { valid: true };
};

/**
 * Validate that image name matches allowed patterns.
 */
export const validateImagePattern = (
	imageName: string,
	allowedPatterns: string[],
): ConstraintResult => {
	if (!matchesAnyPattern(imageName, allowedPatterns)) {
		return {
			valid: false,
			violation: `Operation denied: Image '${imageName}' not in allowed patterns. Allowed: ${allowedPatterns.join(", ")}`,
		};
	}
	return { valid: true };
};

/**
 * Validate that container name matches allowed patterns.
 */
export const validateContainerPattern = (
	containerName: string,
	allowedPatterns: string[],
): ConstraintResult => {
	// Strip leading slash if present (Docker adds it)
	const name = containerName.startsWith("/")
		? containerName.slice(1)
		: containerName;

	if (!matchesAnyPattern(name, allowedPatterns)) {
		return {
			valid: false,
			violation: `Operation denied: Container '${name}' not in allowed patterns. Allowed: ${allowedPatterns.join(", ")}`,
		};
	}
	return { valid: true };
};

/**
 * Parse memory string to bytes.
 * Supports: 512m, 1g, 2G, 1024, etc.
 */
const parseMemory = (memory: string): number | null => {
	const match = memory.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmgtp]?)b?$/);
	if (!match) return null;

	const value = Number.parseFloat(match[1]);
	const unit = match[2];

	const multipliers: Record<string, number> = {
		"": 1,
		k: 1024,
		m: 1024 * 1024,
		g: 1024 * 1024 * 1024,
		t: 1024 * 1024 * 1024 * 1024,
		p: 1024 * 1024 * 1024 * 1024 * 1024,
	};

	return Math.floor(value * (multipliers[unit] ?? 1));
};

/**
 * Validate resource limits.
 */
export const validateResourceLimits = (
	config: ContainerConfig,
	maxMemory?: string,
	maxCpus?: number,
): ConstraintResult => {
	const hostConfig = config.HostConfig;

	if (maxMemory && hostConfig?.Memory) {
		const maxBytes = parseMemory(maxMemory);
		if (maxBytes && hostConfig.Memory > maxBytes) {
			return {
				valid: false,
				violation: `Operation denied: Memory limit ${hostConfig.Memory} exceeds maximum ${maxMemory}`,
			};
		}
	}

	if (maxCpus && hostConfig?.NanoCpus) {
		const containerCpus = hostConfig.NanoCpus / 1e9;
		if (containerCpus > maxCpus) {
			return {
				valid: false,
				violation: `Operation denied: CPU limit ${containerCpus} exceeds maximum ${maxCpus}`,
			};
		}
	}

	return { valid: true };
};

// =============================================================================
// Main Constraint Validation
// =============================================================================

export interface ValidationContext {
	containerConfig?: ContainerConfig;
	imageName?: string;
	containerName?: string;
}

/**
 * Validate all constraints for a matched rule.
 */
export const validateConstraints = (
	rule: PermissionPattern,
	context: ValidationContext,
): ConstraintResult => {
	// If no constraints, allow
	if (!rule.constraints || rule.constraints.length === 0) {
		return { valid: true };
	}

	// Validate each constraint - ALL must pass
	for (const c of rule.constraints) {
		const type = typeof c === "string" ? c : c.type;
		let result: ConstraintResult;

		switch (type) {
			case "no_privileged": {
				if (context.containerConfig) {
					result = validateNoPrivileged(context.containerConfig);
				} else {
					result = { valid: true };
				}
				break;
			}

			case "no_host_network": {
				if (context.containerConfig) {
					result = validateNoHostNetwork(context.containerConfig);
				} else {
					result = { valid: true };
				}
				break;
			}

			case "allowed_mounts": {
				if (
					typeof c === "object" &&
					c.type === "allowed_mounts" &&
					context.containerConfig
				) {
					result = validateAllowedMounts(context.containerConfig, c.value);
				} else {
					result = { valid: true };
				}
				break;
			}

			case "image_pattern": {
				if (
					typeof c === "object" &&
					c.type === "image_pattern" &&
					context.imageName
				) {
					result = validateImagePattern(context.imageName, c.value);
				} else {
					result = { valid: true };
				}
				break;
			}

			case "container_pattern": {
				if (
					typeof c === "object" &&
					c.type === "container_pattern" &&
					context.containerName
				) {
					result = validateContainerPattern(context.containerName, c.value);
				} else {
					result = { valid: true };
				}
				break;
			}

			case "resource_limits": {
				if (
					typeof c === "object" &&
					c.type === "resource_limits" &&
					context.containerConfig
				) {
					result = validateResourceLimits(
						context.containerConfig,
						c.max_memory,
						c.max_cpus,
					);
				} else {
					result = { valid: true };
				}
				break;
			}

			default:
				result = {
					valid: false,
					violation: `Operation denied: Unknown constraint type '${type}'`,
				};
		}

		if (!result.valid) {
			return result;
		}
	}

	return { valid: true };
};
