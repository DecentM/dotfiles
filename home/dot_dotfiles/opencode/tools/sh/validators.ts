/**
 * Constraint validators for the sh tool.
 */

import { resolve } from "node:path";
import {
	extractPaths,
	isPathWithinOrEqual,
	matchesExcludePattern,
	parseCommandTokens,
} from "./parser";
import type {
	ConstraintResult,
	ConstraintType,
	PermissionPattern,
} from "./types";

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
			"cwd_only",
			"no_recursive",
			"no_force",
			"max_depth",
			"require_flag",
		];
		if (!validTypes.includes(c as ConstraintType)) {
			return `Rule ${ruleIndex}: Invalid constraint type '${c}'`;
		}
		// String shorthand for max_depth/require_flag is invalid (needs params)
		if (c === "max_depth" || c === "require_flag") {
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
		case "cwd_only":
			if (obj.also_allow !== undefined && !Array.isArray(obj.also_allow)) {
				return `Rule ${ruleIndex}: cwd_only.also_allow must be an array`;
			}
			if (obj.exclude !== undefined && !Array.isArray(obj.exclude)) {
				return `Rule ${ruleIndex}: cwd_only.exclude must be an array`;
			}
			break;
		case "max_depth":
			if (typeof obj.value !== "number" || obj.value < 0) {
				return `Rule ${ruleIndex}: max_depth requires a non-negative 'value'`;
			}
			break;
		case "require_flag":
			if (typeof obj.flag !== "string" || obj.flag.length === 0) {
				return `Rule ${ruleIndex}: require_flag requires a non-empty 'flag'`;
			}
			break;
		case "no_recursive":
		case "no_force":
			break;
		default:
			return `Rule ${ruleIndex}: Unknown constraint type '${obj.type}'`;
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
	const errors: string[] = [];

	if (typeof parsed !== "object" || parsed === null) {
		return ["Config must be an object"];
	}

	const config = parsed as Record<string, unknown>;

	if (!Array.isArray(config.rules)) {
		return ['Config must have a "rules" array'];
	}

	for (let i = 0; i < config.rules.length; i++) {
		const err = validateYamlRule(config.rules[i], i);
		if (err) errors.push(err);
	}

	if (
		config.default !== undefined &&
		config.default !== "allow" &&
		config.default !== "deny"
	) {
		errors.push("'default' must be 'allow' or 'deny'");
	}

	if (
		config.default_reason !== undefined &&
		typeof config.default_reason !== "string"
	) {
		errors.push("'default_reason' must be a string");
	}

	return errors;
};

// =============================================================================
// Constraint Validators
// =============================================================================

/**
 * Validate that all path arguments are within the working directory.
 */
export const validateCwdOnly = (
	command: string,
	workdir: string,
	options?: { also_allow?: string[]; exclude?: string[] },
): ConstraintResult => {
	const paths = extractPaths(command);

	// Commands with no path arguments implicitly use cwd - allow
	if (paths.length === 0) {
		return { valid: true };
	}

	for (const p of paths) {
		// Special case: cd - (previous directory)
		if (p === "-") {
			return {
				valid: false,
				violation: `Command denied: 'cd -' not allowed (unknown destination)`,
			};
		}

		// Special case: home directory
		if (p === "~" || p.startsWith("~/")) {
			// Check if ~ is in also_allow
			if (options?.also_allow?.includes("~")) continue;
			return {
				valid: false,
				violation: `Command denied: Home directory (~) not allowed`,
			};
		}

		// Resolve to absolute path
		const resolved = resolve(workdir, p);

		// Check exclude patterns first
		if (options?.exclude) {
			const matchedPattern = matchesExcludePattern(resolved, options.exclude);
			if (matchedPattern) {
				return {
					valid: false,
					violation: `Command denied: Path '${p}' matches excluded pattern '${matchedPattern}'`,
				};
			}
		}

		// Check if within cwd using robust path.relative() method
		const isWithinCwd = isPathWithinOrEqual(resolved, workdir);

		if (!isWithinCwd) {
			// Check also_allow list
			if (options?.also_allow) {
				let isAllowed = false;
				for (const allowed of options.also_allow) {
					if (allowed === "~") continue; // Already handled above
					if (isPathWithinOrEqual(resolved, allowed)) {
						isAllowed = true;
						break;
					}
				}
				if (isAllowed) continue;
			}

			return {
				valid: false,
				violation: `Command denied: Path '${p}' resolves to '${resolved}' which is outside working directory '${workdir}'`,
			};
		}
	}

	return { valid: true };
};

/**
 * Check if a token contains a specific short flag.
 * Handles combined flags like -rf, -Rf, etc.
 */
export const hasShortFlag = (token: string, flag: string): boolean => {
	// Single character flag without the dash
	const flagChar = flag.replace(/^-/, "");
	if (flagChar.length !== 1) return false;

	// Check for exact match
	if (token === `-${flagChar}`) return true;

	// Check for combined flags (e.g., -rf, -Rf)
	// Must start with single dash, not be a long option
	if (token.startsWith("-") && !token.startsWith("--") && token.length > 2) {
		return token.includes(flagChar);
	}

	return false;
};

/**
 * Validate that the command doesn't contain recursive flags.
 */
export const validateNoRecursive = (command: string): ConstraintResult => {
	const tokens = parseCommandTokens(command);

	for (const token of tokens) {
		// Check for long flag
		if (token === "--recursive") {
			return {
				valid: false,
				violation: `Command denied: Recursive flag not allowed (${token})`,
			};
		}

		// Check for short flags -r and -R (including combined like -rf)
		if (hasShortFlag(token, "-r") || hasShortFlag(token, "-R")) {
			return {
				valid: false,
				violation: `Command denied: Recursive flag not allowed (${token})`,
			};
		}
	}

	return { valid: true };
};

/**
 * Validate that the command doesn't contain force flags.
 */
export const validateNoForce = (command: string): ConstraintResult => {
	const tokens = parseCommandTokens(command);

	for (const token of tokens) {
		// Check for long flag
		if (token === "--force") {
			return {
				valid: false,
				violation: `Command denied: Force flag not allowed (${token})`,
			};
		}

		// Check for short flag -f (including combined like -rf)
		if (hasShortFlag(token, "-f")) {
			return {
				valid: false,
				violation: `Command denied: Force flag not allowed (${token})`,
			};
		}
	}

	return { valid: true };
};

/**
 * Validate that the command specifies a maxdepth within allowed limits.
 */
export const validateMaxDepth = (
	command: string,
	maxAllowed: number,
): ConstraintResult => {
	const tokens = parseCommandTokens(command);
	let foundMaxdepth = false;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token === "-maxdepth" || token === "--max-depth") {
			foundMaxdepth = true;
			const depthStr = tokens[i + 1];

			if (!depthStr) {
				return {
					valid: false,
					violation: `Command denied: Missing value for ${token}`,
				};
			}

			const depth = Number.parseInt(depthStr, 10);
			if (Number.isNaN(depth)) {
				return {
					valid: false,
					violation: `Command denied: Invalid depth value '${depthStr}'`,
				};
			}

			if (depth > maxAllowed) {
				return {
					valid: false,
					violation: `Command denied: Depth ${depth} exceeds maximum allowed (${maxAllowed})`,
				};
			}
		}
	}

	if (!foundMaxdepth) {
		return {
			valid: false,
			violation: `Command denied: Must specify -maxdepth (max ${maxAllowed}) for safety`,
		};
	}

	return { valid: true };
};

/**
 * Validate that a required flag is present in the command.
 */
export const validateRequireFlag = (
	command: string,
	requiredFlag: string,
): ConstraintResult => {
	const tokens = parseCommandTokens(command);

	// Direct match
	if (tokens.includes(requiredFlag)) {
		return { valid: true };
	}

	// For short flags, check combined flags too
	if (
		requiredFlag.startsWith("-") &&
		!requiredFlag.startsWith("--") &&
		requiredFlag.length === 2
	) {
		for (const token of tokens) {
			if (hasShortFlag(token, requiredFlag)) {
				return { valid: true };
			}
		}
	}

	return {
		valid: false,
		violation: `Command denied: Required flag '${requiredFlag}' not found`,
	};
};

/**
 * Validate all constraints for a matched rule.
 */
export const validateConstraints = (
	command: string,
	workdir: string,
	rule: PermissionPattern,
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
			case "cwd_only": {
				const options =
					typeof c === "object" && c.type === "cwd_only"
						? { also_allow: c.also_allow, exclude: c.exclude }
						: undefined;
				result = validateCwdOnly(command, workdir, options);
				break;
			}

			case "no_recursive":
				result = validateNoRecursive(command);
				break;

			case "no_force":
				result = validateNoForce(command);
				break;

			case "max_depth": {
				if (typeof c === "object" && c.type === "max_depth") {
					result = validateMaxDepth(command, c.value);
				} else {
					result = {
						valid: false,
						violation: `Command denied: max_depth constraint requires a 'value' parameter`,
					};
				}
				break;
			}

			case "require_flag": {
				if (typeof c === "object" && c.type === "require_flag") {
					result = validateRequireFlag(command, c.flag);
				} else {
					result = {
						valid: false,
						violation: `Command denied: require_flag constraint requires a 'flag' parameter`,
					};
				}
				break;
			}

			default:
				result = {
					valid: false,
					violation: `Command denied: Unknown constraint type '${type}'`,
				};
		}

		if (!result.valid) {
			return result;
		}
	}

	return { valid: true };
};
