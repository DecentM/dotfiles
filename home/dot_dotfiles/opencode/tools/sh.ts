/**
 * Custom shell execution tool with permission enforcement and auditing.
 * Replaces the built-in bash tool with:
 * - Allowlist-based command permissions
 * - SQLite audit logging
 * - Stats, export, and hierarchy tools
 */

import { tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, relative, isAbsolute } from "node:path";

// =============================================================================
// Database Setup
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "commands.db");

/**
 * Database connection manager with cleanup support.
 */
const dbManager = (() => {
  let db: Database | null = null;

  const get = (): Database => {
    if (!db) {
      if (!existsSync(AUDIT_DIR)) {
        mkdirSync(AUDIT_DIR, { recursive: true });
      }
      db = new Database(DB_PATH);
      db.run(`
        CREATE TABLE IF NOT EXISTS command_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          session_id TEXT,
          message_id TEXT,
          command TEXT NOT NULL,
          workdir TEXT,
          pattern_matched TEXT,
          decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
          exit_code INTEGER,
          duration_ms INTEGER
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON command_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_decision ON command_log(decision)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_command ON command_log(command)`);
    }
    return db;
  };

  const close = (): void => {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors during shutdown
      }
      db = null;
    }
  };

  return { get, close };
})();

// Register cleanup handlers for graceful shutdown
process.on("exit", () => dbManager.close());
process.on("SIGINT", () => {
  dbManager.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  dbManager.close();
  process.exit(0);
});

/** @deprecated Use dbManager.get() - kept for backward compatibility */
const getDb = () => dbManager.get();

// =============================================================================
// Permission Patterns
// =============================================================================

type Decision = "allow" | "deny";

// =============================================================================
// Constraint Types
// =============================================================================

type ConstraintType = 'cwd_only' | 'no_recursive' | 'no_force' | 'max_depth' | 'require_flag';

interface CwdOnlyConstraint {
  type: 'cwd_only';
  also_allow?: string[];
  exclude?: string[];
}

interface MaxDepthConstraint {
  type: 'max_depth';
  value: number;
}

interface RequireFlagConstraint {
  type: 'require_flag';
  flag: string;
}

interface NoRecursiveConstraint {
  type: 'no_recursive';
}

interface NoForceConstraint {
  type: 'no_force';
}

type ConstraintConfig =
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

export interface PermissionPattern {
  pattern: string;
  decision: Decision;
  reason?: string;
  constraint?: ConstraintConfig;      // Single constraint
  constraints?: ConstraintConfig[];   // Multiple constraints
}

/**
 * Compiled permission pattern with pre-built regex for performance.
 */
interface CompiledPermissionPattern extends PermissionPattern {
  compiledRegex: RegExp;
}

interface PermissionsConfig {
  rules: CompiledPermissionPattern[];
  default: Decision;
  default_reason: string;
}

// Default fallback configuration if YAML fails to load
const FALLBACK_CONFIG: PermissionsConfig = {
  rules: [],
  default: "deny",
  default_reason: "Permissions file failed to load - all commands denied for safety",
};

// =============================================================================
// YAML Schema Validation
// =============================================================================

/**
 * Validate a constraint configuration.
 * Returns an error message if invalid, undefined if valid.
 */
const validateConstraint = (c: unknown, index: number, ruleIndex: number): string | undefined => {
  if (typeof c === 'string') {
    const validTypes: ConstraintType[] = ['cwd_only', 'no_recursive', 'no_force', 'max_depth', 'require_flag'];
    if (!validTypes.includes(c as ConstraintType)) {
      return `Rule ${ruleIndex}: Invalid constraint type '${c}'`;
    }
    // String shorthand for max_depth/require_flag is invalid (needs params)
    if (c === 'max_depth' || c === 'require_flag') {
      return `Rule ${ruleIndex}: Constraint '${c}' requires object form with parameters`;
    }
    return undefined;
  }

  if (typeof c !== 'object' || c === null) {
    return `Rule ${ruleIndex}: Constraint ${index} must be a string or object`;
  }

  const obj = c as Record<string, unknown>;
  if (typeof obj.type !== 'string') {
    return `Rule ${ruleIndex}: Constraint ${index} missing 'type' field`;
  }

  switch (obj.type) {
    case 'cwd_only':
      if (obj.also_allow !== undefined && !Array.isArray(obj.also_allow)) {
        return `Rule ${ruleIndex}: cwd_only.also_allow must be an array`;
      }
      if (obj.exclude !== undefined && !Array.isArray(obj.exclude)) {
        return `Rule ${ruleIndex}: cwd_only.exclude must be an array`;
      }
      break;
    case 'max_depth':
      if (typeof obj.value !== 'number' || obj.value < 0) {
        return `Rule ${ruleIndex}: max_depth requires a non-negative 'value'`;
      }
      break;
    case 'require_flag':
      if (typeof obj.flag !== 'string' || obj.flag.length === 0) {
        return `Rule ${ruleIndex}: require_flag requires a non-empty 'flag'`;
      }
      break;
    case 'no_recursive':
    case 'no_force':
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
const validateYamlRule = (rule: unknown, index: number): string | undefined => {
  if (typeof rule !== 'object' || rule === null) {
    return `Rule ${index}: Must be an object`;
  }

  const r = rule as Record<string, unknown>;

  // Must have pattern or patterns
  const hasPattern = typeof r.pattern === 'string';
  const hasPatterns = Array.isArray(r.patterns) && r.patterns.every(p => typeof p === 'string');
  if (!hasPattern && !hasPatterns) {
    return `Rule ${index}: Must have 'pattern' (string) or 'patterns' (string array)`;
  }

  // Must have valid decision
  if (r.decision !== 'allow' && r.decision !== 'deny') {
    return `Rule ${index}: 'decision' must be 'allow' or 'deny'`;
  }

  // Reason is optional but must be string or null
  if (r.reason !== undefined && r.reason !== null && typeof r.reason !== 'string') {
    return `Rule ${index}: 'reason' must be a string or null`;
  }

  // Validate single constraint
  if (r.constraint !== undefined) {
    const err = validateConstraint(r.constraint, 0, index);
    if (err) return err;
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
const validateYamlConfig = (parsed: unknown): string[] => {
  const errors: string[] = [];

  if (typeof parsed !== 'object' || parsed === null) {
    return ['Config must be an object'];
  }

  const config = parsed as Record<string, unknown>;

  if (!Array.isArray(config.rules)) {
    return ['Config must have a "rules" array'];
  }

  for (let i = 0; i < config.rules.length; i++) {
    const err = validateYamlRule(config.rules[i], i);
    if (err) errors.push(err);
  }

  if (config.default !== undefined && config.default !== 'allow' && config.default !== 'deny') {
    errors.push("'default' must be 'allow' or 'deny'");
  }

  if (config.default_reason !== undefined && typeof config.default_reason !== 'string') {
    errors.push("'default_reason' must be a string");
  }

  return errors;
};

/**
 * Raw rule format from YAML - supports both single pattern and multiple patterns.
 */
interface YamlRule {
  pattern?: string;
  patterns?: string[];
  decision: string;
  reason?: string | null;
  constraint?: ConstraintConfig;
  constraints?: ConstraintConfig[];
}

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 */
export const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
};

/**
 * Load permissions from YAML file.
 * Uses a singleton pattern to load only once.
 * Pre-compiles regexes for performance.
 *
 * Supports two rule formats:
 * 1. Single pattern:  { pattern: "rm*", decision: "deny", reason: "..." }
 * 2. Multi-pattern:   { patterns: ["rm*", "rmdir*"], decision: "deny", reason: "..." }
 */
const getPermissions = (() => {
  let config: PermissionsConfig | null = null;

  return (): PermissionsConfig => {
    if (config) return config;

    const yamlPath = join(import.meta.dir, "sh-permissions.yaml");

    try {
      const yamlContent = readFileSync(yamlPath, "utf-8");
      const parsed = Bun.YAML.parse(yamlContent);

      // Validate YAML structure
      const validationErrors = validateYamlConfig(parsed);
      if (validationErrors.length > 0) {
        console.error("[sh] Invalid permissions YAML:");
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
        const constraint = rule.constraint;
        const constraints = rule.constraints;

        for (const pattern of patterns) {
          expandedRules.push({
            pattern,
            decision,
            reason,
            constraint,
            constraints,
            compiledRegex: patternToRegex(pattern),
          });
        }
      }

      config = {
        rules: expandedRules,
        default: (typedParsed.default as Decision) ?? "deny",
        default_reason: typedParsed.default_reason ?? "Command not in allowlist",
      };

      return config;
    } catch (error) {
      console.error(`[sh] Failed to load permissions from ${yamlPath}:`, error);
      config = FALLBACK_CONFIG;
      return config;
    }
  };
})();

// =============================================================================
// Pattern Matching
// =============================================================================

export interface MatchResult {
  decision: Decision;
  pattern: string | null;
  reason?: string;
  isDefault?: boolean;
  rule?: PermissionPattern;  // Full rule for constraint checking
}

/**
 * Find the first matching permission pattern for a command.
 * Uses pre-compiled regexes for performance.
 */
export const matchCommand = (command: string): MatchResult => {
  const trimmed = command.trim();
  const config = getPermissions();

  for (const perm of config.rules) {
    if (perm.compiledRegex.test(trimmed)) {
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

// =============================================================================
// Command Parsing & Path Extraction
// =============================================================================

/**
 * Parse a command into tokens, respecting quoted strings.
 * Handles both single and double quotes.
 */
export const parseCommandTokens = (command: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inQuote) {
      escapeNext = true;
      continue;
    }

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) tokens.push(current);
  return tokens;
};

/**
 * Extract arguments that don't start with '-' (non-flag args).
 */
export const extractNonFlagArgs = (args: string[]): string[] => {
  return args.filter(arg => !arg.startsWith('-'));
};

/**
 * Skip the first non-flag arg (e.g., pattern for grep), return rest.
 */
export const extractNonFlagArgsAfterFirst = (args: string[]): string[] => {
  const nonFlags = extractNonFlagArgs(args);
  return nonFlags.slice(1);
};

/**
 * Command-specific path extractors.
 * Maps command name to a function that extracts path arguments.
 */
const PATH_EXTRACTORS: Record<string, (args: string[]) => string[]> = {
  'cd': (args) => {
    // cd with no args goes to ~
    if (args.length === 0) return ['~'];
    // Special case: cd - (previous directory) - check BEFORE filtering
    // since "-" looks like a flag but has special meaning for cd
    if (args[0] === '-' || args.includes('-')) {
      return ['-'];
    }
    const filtered = extractNonFlagArgs(args);
    if (filtered.length === 0) return ['~'];
    return [filtered[0]];
  },
  'ls': (args) => {
    const paths = extractNonFlagArgs(args);
    return paths.length > 0 ? paths : ['.'];
  },
  'cat': (args) => extractNonFlagArgs(args),
  'head': (args) => extractNonFlagArgs(args),
  'tail': (args) => extractNonFlagArgs(args),
  'find': (args) => {
    // find takes paths before the first flag (-name, -type, etc.)
    const paths: string[] = [];
    for (const arg of args) {
      if (arg.startsWith('-')) break;
      paths.push(arg);
    }
    return paths.length > 0 ? paths : ['.'];
  },
  'grep': (args) => {
    // grep [options] pattern [files...]
    // Skip options and pattern, get files
    return extractNonFlagArgsAfterFirst(args);
  },
  'rg': (args) => {
    // ripgrep: rg [options] pattern [paths...]
    return extractNonFlagArgsAfterFirst(args);
  },
  'tree': (args) => {
    const paths = extractNonFlagArgs(args);
    return paths.length > 0 ? paths : ['.'];
  },
  'du': (args) => {
    const paths = extractNonFlagArgs(args);
    return paths.length > 0 ? paths : ['.'];
  },
  'cp': (args) => extractNonFlagArgs(args),
  'mv': (args) => extractNonFlagArgs(args),
  'rm': (args) => extractNonFlagArgs(args),
  'stat': (args) => extractNonFlagArgs(args),
  'file': (args) => extractNonFlagArgs(args),
  'touch': (args) => extractNonFlagArgs(args),
  'mkdir': (args) => extractNonFlagArgs(args),
  'rmdir': (args) => extractNonFlagArgs(args),
  'ln': (args) => extractNonFlagArgs(args),
  'readlink': (args) => extractNonFlagArgs(args),
  'realpath': (args) => extractNonFlagArgs(args),
};

/**
 * Extract path arguments from a command using command-specific logic.
 */
export const extractPaths = (command: string): string[] => {
  const tokens = parseCommandTokens(command);
  if (tokens.length === 0) return [];

  const cmdName = tokens[0];
  const args = tokens.slice(1);

  const extractor = PATH_EXTRACTORS[cmdName] ?? extractNonFlagArgs;
  return extractor(args);
};

/**
 * Match a path or filename against a glob-like pattern.
 * Supports * as wildcard.
 */
const matchPattern = (value: string, pattern: string): boolean => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
};

/**
 * Check if a path matches any of the given glob patterns.
 * Checks both the full path segments and basename.
 */
const matchesExcludePattern = (resolvedPath: string, patterns: string[]): string | undefined => {
  const segments = resolvedPath.split('/').filter(Boolean);
  const base = basename(resolvedPath);

  for (const pattern of patterns) {
    // Check basename
    if (matchPattern(base, pattern)) {
      return pattern;
    }
    // Check each path segment
    for (const segment of segments) {
      if (matchPattern(segment, pattern)) {
        return pattern;
      }
    }
  }
  return undefined;
};

/**
 * Check if a resolved path is within a base directory using path.relative().
 * This is more robust than string prefix matching.
 */
const isPathWithin = (resolvedPath: string, baseDir: string): boolean => {
  const normalizedBase = baseDir.endsWith('/') ? baseDir.slice(0, -1) : baseDir;
  const rel = relative(normalizedBase, resolvedPath);
  // Path is within if relative path doesn't start with '..' and isn't absolute
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * Check if a resolved path equals or is within a base directory.
 */
const isPathWithinOrEqual = (resolvedPath: string, baseDir: string): boolean => {
  const normalizedBase = baseDir.endsWith('/') ? baseDir.slice(0, -1) : baseDir;
  if (resolvedPath === normalizedBase) return true;
  return isPathWithin(resolvedPath, normalizedBase);
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
  options?: { also_allow?: string[]; exclude?: string[] }
): ConstraintResult => {
  const paths = extractPaths(command);

  // Commands with no path arguments implicitly use cwd - allow
  if (paths.length === 0) {
    return { valid: true };
  }

  for (const p of paths) {
    // Special case: cd - (previous directory)
    if (p === '-') {
      return { valid: false, violation: `Command denied: 'cd -' not allowed (unknown destination)` };
    }

    // Special case: home directory
    if (p === '~' || p.startsWith('~/')) {
      // Check if ~ is in also_allow
      if (options?.also_allow?.includes('~')) continue;
      return { valid: false, violation: `Command denied: Home directory (~) not allowed` };
    }

    // Resolve to absolute path
    const resolved = resolve(workdir, p);

    // Check exclude patterns first
    if (options?.exclude) {
      const matchedPattern = matchesExcludePattern(resolved, options.exclude);
      if (matchedPattern) {
        return {
          valid: false,
          violation: `Command denied: Path '${p}' matches excluded pattern '${matchedPattern}'`
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
          if (allowed === '~') continue; // Already handled above
          if (isPathWithinOrEqual(resolved, allowed)) {
            isAllowed = true;
            break;
          }
        }
        if (isAllowed) continue;
      }

      return {
        valid: false,
        violation: `Command denied: Path '${p}' resolves to '${resolved}' which is outside working directory '${workdir}'`
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
  const flagChar = flag.replace(/^-/, '');
  if (flagChar.length !== 1) return false;

  // Check for exact match
  if (token === `-${flagChar}`) return true;

  // Check for combined flags (e.g., -rf, -Rf)
  // Must start with single dash, not be a long option
  if (token.startsWith('-') && !token.startsWith('--') && token.length > 2) {
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
    if (token === '--recursive') {
      return { valid: false, violation: `Command denied: Recursive flag not allowed (${token})` };
    }

    // Check for short flags -r and -R (including combined like -rf)
    if (hasShortFlag(token, '-r') || hasShortFlag(token, '-R')) {
      return { valid: false, violation: `Command denied: Recursive flag not allowed (${token})` };
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
    if (token === '--force') {
      return { valid: false, violation: `Command denied: Force flag not allowed (${token})` };
    }

    // Check for short flag -f (including combined like -rf)
    if (hasShortFlag(token, '-f')) {
      return { valid: false, violation: `Command denied: Force flag not allowed (${token})` };
    }
  }

  return { valid: true };
};

/**
 * Validate that the command specifies a maxdepth within allowed limits.
 */
export const validateMaxDepth = (command: string, maxAllowed: number): ConstraintResult => {
  const tokens = parseCommandTokens(command);
  let foundMaxdepth = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-maxdepth' || token === '--max-depth') {
      foundMaxdepth = true;
      const depthStr = tokens[i + 1];

      if (!depthStr) {
        return { valid: false, violation: `Command denied: Missing value for ${token}` };
      }

      const depth = parseInt(depthStr, 10);
      if (isNaN(depth)) {
        return { valid: false, violation: `Command denied: Invalid depth value '${depthStr}'` };
      }

      if (depth > maxAllowed) {
        return { valid: false, violation: `Command denied: Depth ${depth} exceeds maximum allowed (${maxAllowed})` };
      }
    }
  }

  if (!foundMaxdepth) {
    return { valid: false, violation: `Command denied: Must specify -maxdepth (max ${maxAllowed}) for safety` };
  }

  return { valid: true };
};

/**
 * Validate that a required flag is present in the command.
 */
export const validateRequireFlag = (command: string, requiredFlag: string): ConstraintResult => {
  const tokens = parseCommandTokens(command);

  // Direct match
  if (tokens.includes(requiredFlag)) {
    return { valid: true };
  }

  // For short flags, check combined flags too
  if (requiredFlag.startsWith('-') && !requiredFlag.startsWith('--') && requiredFlag.length === 2) {
    for (const token of tokens) {
      if (hasShortFlag(token, requiredFlag)) {
        return { valid: true };
      }
    }
  }

  return { valid: false, violation: `Command denied: Required flag '${requiredFlag}' not found` };
};

/**
 * Validate all constraints for a matched rule.
 */
export const validateConstraints = (
  command: string,
  workdir: string,
  rule: PermissionPattern
): ConstraintResult => {
  // Collect all constraints
  const constraints: ConstraintConfig[] = [];

  if (rule.constraint) {
    constraints.push(rule.constraint);
  }
  if (rule.constraints) {
    constraints.push(...rule.constraints);
  }

  // If no constraints, allow
  if (constraints.length === 0) {
    return { valid: true };
  }

  // Validate each constraint - ALL must pass
  for (const c of constraints) {
    const type = typeof c === 'string' ? c : c.type;
    let result: ConstraintResult;

    switch (type) {
      case 'cwd_only': {
        const options = typeof c === 'object' && c.type === 'cwd_only'
          ? { also_allow: c.also_allow, exclude: c.exclude }
          : undefined;
        result = validateCwdOnly(command, workdir, options);
        break;
      }

      case 'no_recursive':
        result = validateNoRecursive(command);
        break;

      case 'no_force':
        result = validateNoForce(command);
        break;

      case 'max_depth': {
        if (typeof c === 'object' && c.type === 'max_depth') {
          result = validateMaxDepth(command, c.value);
        } else {
          result = { valid: false, violation: `Command denied: max_depth constraint requires a 'value' parameter` };
        }
        break;
      }

      case 'require_flag': {
        if (typeof c === 'object' && c.type === 'require_flag') {
          result = validateRequireFlag(command, c.flag);
        } else {
          result = { valid: false, violation: `Command denied: require_flag constraint requires a 'flag' parameter` };
        }
        break;
      }

      default:
        result = { valid: false, violation: `Command denied: Unknown constraint type '${type}'` };
    }

    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
};

// =============================================================================
// Audit Logging
// =============================================================================

interface LogEntry {
  sessionId?: string;
  messageId?: string;
  command: string;
  workdir?: string;
  patternMatched: string | null;
  decision: Decision;
  exitCode?: number;
  durationMs?: number;
}

const logCommand = (entry: LogEntry): number => {
  const db = getDb();
  const result = db.run(
    `INSERT INTO command_log
     (session_id, message_id, command, workdir, pattern_matched, decision, exit_code, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId ?? null,
      entry.messageId ?? null,
      entry.command,
      entry.workdir ?? null,
      entry.patternMatched,
      entry.decision,
      entry.exitCode ?? null,
      entry.durationMs ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
};

const updateLogEntry = (id: number, exitCode: number, durationMs: number) => {
  const db = getDb();
  db.run(
    `UPDATE command_log SET exit_code = ?, duration_ms = ? WHERE id = ?`,
    [exitCode, durationMs, id]
  );
};

// =============================================================================
// Main Shell Tool
// =============================================================================

export default tool({
  description: `Execute shell commands with permission enforcement and audit logging.
Commands are checked against an allowlist before execution.
Denied commands will return an error with the reason.`,
  args: {
    command: tool.schema.string().describe("The shell command to execute"),
    workdir: tool.schema.string().optional().describe("Working directory for command execution"),
    timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 120000)"),
  },
  async execute(args, context) {
    const { command, workdir, timeout = 120000 } = args;
    const { sessionID, messageID } = context;

    // Check permissions
    const match = matchCommand(command);

    if (match.decision === "deny") {
      // Log the denied attempt
      logCommand({
        sessionId: sessionID,
        messageId: messageID,
        command,
        workdir,
        patternMatched: match.pattern,
        decision: "deny",
      });

      // Standardized error format
      const reason = match.reason ?? "Command not in allowlist";
      const patternInfo = match.pattern ? `\nPattern: ${match.pattern}` : "";
      return `Error: Command denied\nReason: ${reason}${patternInfo}\n\nCommand: ${command}`;
    }

    // Check constraints for allowed commands
    if (match.rule) {
      const effectiveWorkdir = workdir ?? process.cwd();
      const constraintResult = validateConstraints(command, effectiveWorkdir, match.rule);

      if (!constraintResult.valid) {
        // Log as denied due to constraint violation
        logCommand({
          sessionId: sessionID,
          messageId: messageID,
          command,
          workdir,
          patternMatched: match.pattern,
          decision: "deny",
        });

        // Standardized error format - violation message already includes "Command denied:"
        const reasonInfo = match.reason ? `\nReason: ${match.reason}` : "";
        return `Error: ${constraintResult.violation}\nPattern: ${match.pattern}${reasonInfo}\n\nCommand: ${command}`;
      }
    }

    // Log the allowed attempt (will update with exit code after)
    const logId = logCommand({
      sessionId: sessionID,
      messageId: messageID,
      command,
      workdir,
      patternMatched: match.pattern,
      decision: "allow",
    });

    const startTime = performance.now();

    try {
      // Execute the command
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: workdir ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });

      /**
       * Terminate process with signal escalation.
       * Tries SIGTERM first, then SIGKILL after grace period.
       */
      const terminateProcess = async (): Promise<void> => {
        try {
          // First attempt: SIGTERM (graceful)
          proc.kill("SIGTERM");

          // Wait briefly for graceful shutdown
          const gracePeriod = 1000; // 1 second
          const exited = await Promise.race([
            proc.exited.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), gracePeriod)),
          ]);

          // If still running, escalate to SIGKILL
          if (!exited) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // Process may have exited between check and kill
            }
          }
        } catch {
          // Process may have already exited
        }
      };

      // Handle timeout with proper cleanup
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        terminateProcess();
      }, timeout);

      // Wait for completion
      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      const durationMs = Math.round(performance.now() - startTime);

      // Read output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // Update log with results
      updateLogEntry(logId, timedOut ? -2 : exitCode, durationMs);

      // Handle timeout case
      if (timedOut) {
        return `Error: Command timed out after ${timeout}ms and was terminated\n\nCommand: ${command}`;
      }

      // Format output
      let output = "";
      if (stdout.trim()) {
        output += stdout;
      }
      if (stderr.trim()) {
        if (output) output += "\n";
        output += `[stderr]\n${stderr}`;
      }

      // Truncate if too long
      const MAX_OUTPUT = 50 * 1024; // 50KB
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n...[truncated, ${output.length} bytes total]`;
      }

      if (exitCode !== 0) {
        output = `Command exited with code ${exitCode}\n${output}`;
      }

      return output || "(no output)";
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      updateLogEntry(logId, -1, durationMs);

      return `Error: Command execution failed: ${error instanceof Error ? error.message : String(error)}\n\nCommand: ${command}`;
    }
  },
});

// =============================================================================
// Stats Tool
// =============================================================================

export const stats = tool({
  description: `Show statistics about shell command execution.
Displays counts of allowed/denied commands, most common patterns, etc.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
  },
  async execute(args) {
    const db = getDb();
    const { since, decision } = args;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | null)[] = [];

    if (since) {
      const sinceDate = parseSince(since);
      conditions.push("timestamp >= ?");
      params.push(sinceDate.toISOString());
    }

    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get overall stats
    const overallQuery = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denied,
        AVG(CASE WHEN decision = 'allow' THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM command_log
      ${whereClause}
    `;

    const overall = db.query(overallQuery).get(...params) as {
      total: number;
      allowed: number;
      denied: number;
      avg_duration_ms: number | null;
    };

    // Get top patterns
    const patternsQuery = `
      SELECT
        pattern_matched,
        decision,
        COUNT(*) as count
      FROM command_log
      ${whereClause}
      GROUP BY pattern_matched, decision
      ORDER BY count DESC
      LIMIT 15
    `;

    const patterns = db.query(patternsQuery).all(...params) as Array<{
      pattern_matched: string | null;
      decision: string;
      count: number;
    }>;

    // Get top commands (denied)
    const deniedQuery = `
      SELECT command, COUNT(*) as count
      FROM command_log
      WHERE decision = 'deny'
      ${since ? "AND timestamp >= ?" : ""}
      GROUP BY command
      ORDER BY count DESC
      LIMIT 10
    `;

    const deniedCommands = since
      ? (db.query(deniedQuery).all(parseSince(since).toISOString()) as Array<{
          command: string;
          count: number;
        }>)
      : (db.query(deniedQuery).all() as Array<{ command: string; count: number }>);

    // Format output
    let output = "# Shell Command Statistics\n\n";

    output += `## Overview\n`;
    output += `- Total commands: ${overall.total}\n`;
    output += `- Allowed: ${overall.allowed} (${((overall.allowed / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    output += `- Denied: ${overall.denied} (${((overall.denied / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    if (overall.avg_duration_ms !== null) {
      output += `- Avg execution time: ${overall.avg_duration_ms.toFixed(0)}ms\n`;
    }
    output += "\n";

    if (patterns.length > 0) {
      output += `## Top Patterns\n`;
      output += "| Pattern | Decision | Count |\n";
      output += "|---------|----------|-------|\n";
      for (const p of patterns) {
        output += `| ${p.pattern_matched ?? "(no match)"} | ${p.decision} | ${p.count} |\n`;
      }
      output += "\n";
    }

    if (deniedCommands.length > 0) {
      output += `## Top Denied Commands\n`;
      output += "| Command | Count |\n";
      output += "|---------|-------|\n";
      for (const c of deniedCommands) {
        const truncated = c.command.length > 60 ? c.command.substring(0, 57) + "..." : c.command;
        output += `| \`${truncated}\` | ${c.count} |\n`;
      }
    }

    return output;
  },
});

// =============================================================================
// Export Tool
// =============================================================================

export { stats as export_data };

export const export_logs = tool({
  description: `Export command audit logs as CSV or JSON.`,
  args: {
    format: tool.schema
      .enum(["csv", "json"])
      .optional()
      .default("csv")
      .describe("Output format"),
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
    limit: tool.schema
      .number()
      .optional()
      .default(1000)
      .describe("Maximum number of records"),
  },
  async execute(args) {
    const db = getDb();
    const { format = "csv", since, decision, limit = 1000 } = args;

    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }

    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT timestamp, session_id, command, workdir, pattern_matched, decision, exit_code, duration_ms
      FROM command_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    params.push(limit);

    const rows = db.query(query).all(...params) as Array<{
      timestamp: string;
      session_id: string | null;
      command: string;
      workdir: string | null;
      pattern_matched: string | null;
      decision: string;
      exit_code: number | null;
      duration_ms: number | null;
    }>;

    if (format === "json") {
      return JSON.stringify(rows, null, 2);
    }

    // CSV format
    const headers = [
      "timestamp",
      "session_id",
      "command",
      "workdir",
      "pattern_matched",
      "decision",
      "exit_code",
      "duration_ms",
    ];

    let csv = headers.join(",") + "\n";

    for (const row of rows) {
      const values = [
        row.timestamp,
        row.session_id ?? "",
        `"${row.command.replace(/"/g, '""')}"`,
        row.workdir ?? "",
        row.pattern_matched ?? "",
        row.decision,
        row.exit_code?.toString() ?? "",
        row.duration_ms?.toString() ?? "",
      ];
      csv += values.join(",") + "\n";
    }

    return csv;
  },
});

// =============================================================================
// Hierarchy Tool
// =============================================================================

export const hierarchy = tool({
  description: `Show command hierarchy tree with usage statistics.
Groups commands by their first words to show patterns of usage.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    minCount: tool.schema
      .number()
      .optional()
      .default(1)
      .describe("Minimum count to display"),
  },
  async execute(args) {
    const db = getDb();
    const { since, minCount = 1 } = args;

    // Build query
    const conditions: string[] = [];
    const params: string[] = [];

    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT command, decision
      FROM command_log
      ${whereClause}
    `;

    const rows = db.query(query).all(...params) as Array<{
      command: string;
      decision: string;
    }>;

    // Build hierarchy tree
    interface TreeNode {
      name: string;
      total: number;
      allowed: number;
      denied: number;
      children: Map<string, TreeNode>;
    }

    const root: TreeNode = {
      name: "root",
      total: 0,
      allowed: 0,
      denied: 0,
      children: new Map(),
    };

    for (const row of rows) {
      const parts = row.command.trim().split(/\s+/).slice(0, 3); // First 3 words
      let node = root;

      root.total++;
      if (row.decision === "allow") root.allowed++;
      else root.denied++;

      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, {
            name: part,
            total: 0,
            allowed: 0,
            denied: 0,
            children: new Map(),
          });
        }
        node = node.children.get(part)!;
        node.total++;
        if (row.decision === "allow") node.allowed++;
        else node.denied++;
      }
    }

    // Render tree
    const renderNode = (node: TreeNode, prefix: string, isLast: boolean): string => {
      if (node.total < minCount) return "";

      const denyRate =
        node.total > 0 ? ((node.denied / node.total) * 100).toFixed(1) : "0.0";

      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      let line = "";
      if (node.name !== "root") {
        line = `${prefix}${connector}${node.name} (${node.total} total, ${denyRate}% denied)\n`;
      }

      const children = Array.from(node.children.values())
        .filter((c) => c.total >= minCount)
        .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childIsLast = i === children.length - 1;
        line += renderNode(child, prefix + childPrefix, childIsLast);
      }

      return line;
    };

    let output = "# Command Hierarchy\n\n";
    output += `Total commands: ${root.total}\n`;
    output += `Allowed: ${root.allowed} | Denied: ${root.denied}\n\n`;
    output += "```\n";

    const children = Array.from(root.children.values())
      .filter((c) => c.total >= minCount)
      .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);

    for (let i = 0; i < children.length; i++) {
      output += renderNode(children[i], "", i === children.length - 1);
    }

    output += "```\n";

    return output;
  },
});

// =============================================================================
// Helpers
// =============================================================================

export const parseSince = (since: string): Date => {
  const now = new Date();

  const match = since.match(/^(\d+)(h|d|w|m)$/);
  if (match) {
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    switch (unit) {
      case "h":
        return new Date(now.getTime() - n * 60 * 60 * 1000);
      case "d":
        return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      case "w":
        return new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000);
      case "m":
        return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000);
    }
  }

  // Named periods
  switch (since.toLowerCase()) {
    case "hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "day":
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      // Try parsing as ISO date
      const parsed = new Date(since);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      // Default to 24h
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
};
