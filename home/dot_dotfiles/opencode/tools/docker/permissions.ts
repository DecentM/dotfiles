/**
 * Permission loading and operation matching for the docker tool.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patternToRegex, validateYamlConfig } from "./validators";
import type {
  CompiledPermissionPattern,
  Decision,
  MatchResult,
  PermissionsConfig,
  YamlRule,
} from "./types";

// =============================================================================
// Fallback Configuration
// =============================================================================

// Default fallback configuration if YAML fails to load
const FALLBACK_CONFIG: PermissionsConfig = {
  rules: [],
  default: "deny",
  default_reason:
    "Permissions file failed to load - all operations denied for safety",
};

// =============================================================================
// Permission Loading
// =============================================================================

/**
 * Load permissions from YAML file.
 * Uses a singleton pattern to load only once.
 * Pre-compiles regexes for performance.
 *
 * Supports two rule formats:
 * 1. Single pattern:  { pattern: "container:list", decision: "allow" }
 * 2. Multi-pattern:   { patterns: ["container:list", "image:list"], decision: "allow" }
 */
export const getPermissions = (() => {
  let config: PermissionsConfig | null = null;

  return (): PermissionsConfig => {
    if (config) return config;

    const yamlPath = join(import.meta.dir, "docker-permissions.yaml");

    try {
      const yamlContent = readFileSync(yamlPath, "utf-8");
      const parsed = Bun.YAML.parse(yamlContent);

      // Validate YAML structure
      const validationErrors = validateYamlConfig(parsed);
      if (validationErrors.length > 0) {
        console.error("[docker] Invalid permissions YAML:");
        for (const err of validationErrors) {
          console.error(`  - ${err}`);
        }
        config = FALLBACK_CONFIG;
        return config;
      }

      const typedParsed = parsed as {
        rules: YamlRule[];
        default?: string;
        default_reason?: string;
      };

      // Expand multi-pattern rules into individual pattern rules with pre-compiled regex
      const expandedRules: CompiledPermissionPattern[] = [];

      for (const rule of typedParsed.rules) {
        const patterns = rule.patterns ?? (rule.pattern ? [rule.pattern] : []);
        const decision = rule.decision as Decision;
        const reason = rule.reason ?? undefined;
        const constraints = rule.constraints;

        for (const pattern of patterns) {
          expandedRules.push({
            pattern,
            decision,
            reason,
            constraints,
            compiledRegex: patternToRegex(pattern),
          });
        }
      }

      config = {
        rules: expandedRules,
        default: (typedParsed.default as Decision) ?? "deny",
        default_reason:
          typedParsed.default_reason ?? "Operation not in allowlist",
      };

      return config;
    } catch (error) {
      console.error(`[docker] Failed to load permissions from ${yamlPath}:`, error);
      config = FALLBACK_CONFIG;
      return config;
    }
  };
})();

// =============================================================================
// Operation Matching
// =============================================================================

/**
 * Build an operation pattern string from operation type and target.
 * Examples:
 *   - container:list
 *   - container:create:node:20
 *   - image:pull:ubuntu:22.04
 */
export const buildOperationPattern = (
  operation: string,
  target?: string
): string => {
  if (!target) return operation;
  return `${operation}:${target}`;
};

/**
 * Find the first matching permission pattern for an operation.
 * Uses pre-compiled regexes for performance.
 */
export const matchOperation = (operationPattern: string): MatchResult => {
  const config = getPermissions();

  for (const perm of config.rules) {
    if (perm.compiledRegex.test(operationPattern)) {
      return {
        decision: perm.decision,
        pattern: perm.pattern,
        reason: perm.reason,
        rule: perm,
      };
    }
  }

  // Default: use config default (typically deny) if no pattern matches
  return {
    decision: config.default,
    pattern: null,
    reason: config.default_reason,
    isDefault: true,
  };
};
