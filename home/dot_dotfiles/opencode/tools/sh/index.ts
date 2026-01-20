/**
 * Barrel file for sh tool modules.
 * Re-exports all public APIs from the sh tool.
 */


// Database
export { dbManager, logCommand, updateLogEntry } from "./db";
// Parser
export {
  extractNonFlagArgs,
  extractNonFlagArgsAfterFirst,
  extractPaths,
  isPathWithin,
  isPathWithinOrEqual,
  matchesExcludePattern,
  matchPattern,
  parseCommandTokens,
  patternToRegex,
} from "./parser";
// Permissions
export { getPermissions, matchCommand } from "./permissions";
// Tools
export { export_data, export_logs, hierarchy, stats } from "./tools";
// Types
export type {
  CompiledPermissionPattern,
  ConstraintConfig,
  ConstraintResult,
  ConstraintType,
  CwdOnlyConstraint,
  Decision,
  LogEntry,
  MatchResult,
  MaxDepthConstraint,
  NoForceConstraint,
  NoRecursiveConstraint,
  PermissionPattern,
  PermissionsConfig,
  RequireFlagConstraint,
  YamlRule,
} from "./types";

// Utils
export { parseSince } from "./utils";
// Validators
export {
  hasShortFlag,
  validateConstraint,
  validateConstraints,
  validateCwdOnly,
  validateMaxDepth,
  validateNoForce,
  validateNoRecursive,
  validateRequireFlag,
  validateYamlConfig,
  validateYamlRule,
} from "./validators";
