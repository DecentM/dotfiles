/**
 * YAML loading utilities for the shared permissions library.
 * Creates singleton loaders with regex pre-compilation.
 */

import { readFileSync } from "node:fs";
import type {
  CompiledPermissionPattern,
  Decision,
  PermissionsConfig,
  YamlRule,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a permission loader.
 * @template TConstraint - The constraint configuration type
 */
export interface LoaderOptions<TConstraint> {
  /** Path to the YAML file */
  yamlPath: string;
  /** Function to convert glob pattern to regex */
  patternToRegex: (pattern: string) => RegExp;
  /** Function to validate the parsed YAML config, returns error messages */
  validateConfig: (parsed: unknown) => string[];
  /** Fallback default decision if loading fails */
  fallbackDefault?: Decision;
  /** Fallback default reason if loading fails */
  fallbackDefaultReason?: string;
  /** Log prefix for error messages (e.g., "[sh]", "[docker]") */
  logPrefix: string;
}

// =============================================================================
// Loader Factory
// =============================================================================

/**
 * Create a permission loader function with singleton pattern.
 * The loader will parse YAML once and cache the result.
 *
 * @template TConstraint - The constraint configuration type
 * @param options - Loader configuration options
 * @returns A function that returns the permissions config
 */
export const createPermissionLoader = <TConstraint>(
  options: LoaderOptions<TConstraint>
): (() => PermissionsConfig<TConstraint>) => {
  const {
    yamlPath,
    patternToRegex,
    validateConfig,
    fallbackDefault = "deny",
    fallbackDefaultReason = "Permissions file failed to load - all operations denied for safety",
    logPrefix,
  } = options;

  // Default fallback configuration if YAML fails to load
  const fallbackConfig: PermissionsConfig<TConstraint> = {
    rules: [],
    default: fallbackDefault,
    default_reason: fallbackDefaultReason,
  };

  let config: PermissionsConfig<TConstraint> | null = null;

  return (): PermissionsConfig<TConstraint> => {
    if (config) return config;

    try {
      const yamlContent = readFileSync(yamlPath, "utf-8");
      const parsed = Bun.YAML.parse(yamlContent);

      // Validate YAML structure
      const validationErrors = validateConfig(parsed);
      if (validationErrors.length > 0) {
        console.error(`${logPrefix} Invalid permissions YAML:`);
        for (const err of validationErrors) {
          console.error(`  - ${err}`);
        }
        config = fallbackConfig;
        return config;
      }

      const typedParsed = parsed as {
        rules: YamlRule<TConstraint>[];
        default?: string;
        default_reason?: string;
      };

      // Expand multi-pattern rules into individual pattern rules with pre-compiled regex
      const expandedRules: CompiledPermissionPattern<TConstraint>[] = [];

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
        default: (typedParsed.default as Decision) ?? fallbackDefault,
        default_reason:
          typedParsed.default_reason ?? "Operation not in allowlist",
      };

      return config;
    } catch (error) {
      console.error(
        `${logPrefix} Failed to load permissions from ${yamlPath}:`,
        error
      );
      config = fallbackConfig;
      return config;
    }
  };
};
