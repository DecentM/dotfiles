/**
 * Permission loading and command matching for the sh tool.
 */

import { join } from "node:path";
import {
	createPatternMatcher,
	createPermissionLoader,
} from "../../lib/permissions";
import { patternToRegex } from "./parser";
import type { ConstraintConfig, MatchResult, PermissionsConfig } from "./types";
import { validateYamlConfig } from "./validators";

// =============================================================================
// Permission Loading
// =============================================================================

/**
 * Load permissions from YAML file.
 * Uses a singleton pattern to load only once.
 * Pre-compiles regexes for performance.
 *
 * Supports two rule formats:
 * 1. Single pattern:  { pattern: "rm*", decision: "deny", reason: "..." }
 * 2. Multi-pattern:   { patterns: ["rm*", "rmdir*"], decision: "deny", reason: "..." }
 */
export const getPermissions: () => PermissionsConfig =
	createPermissionLoader<ConstraintConfig>({
		yamlPath: join(import.meta.dir, "..", "sh-permissions.yaml"),
		patternToRegex,
		validateConfig: validateYamlConfig,
		fallbackDefault: "deny",
		fallbackDefaultReason:
			"Permissions file failed to load - all commands denied for safety",
		logPrefix: "[sh]",
	});

// =============================================================================
// Command Matching
// =============================================================================

const matchCommandInternal =
	createPatternMatcher<ConstraintConfig>(getPermissions);

/**
 * Find the first matching permission pattern for a command.
 * Uses pre-compiled regexes for performance.
 */
export const matchCommand = (command: string): MatchResult => {
	const trimmed = command.trim();
	return matchCommandInternal(trimmed);
};
