/**
 * Command parsing and path extraction for the sh tool.
 */

import { basename, isAbsolute, relative } from 'node:path'

// =============================================================================
// Command Parsing
// =============================================================================

/**
 * Parse a command into tokens, respecting quoted strings.
 * Handles both single and double quotes.
 */
export const parseCommandTokens = (command: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null
  let escapeNext = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escapeNext) {
      current += char
      escapeNext = false
      continue
    }

    if (char === '\\' && !inQuote) {
      escapeNext = true
      continue
    }

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 */
export const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

// =============================================================================
// Argument Extraction
// =============================================================================

/**
 * Extract arguments that don't start with '-' (non-flag args).
 */
export const extractNonFlagArgs = (args: string[]): string[] => {
  return args.filter((arg) => !arg.startsWith('-'))
}

/**
 * Skip the first non-flag arg (e.g., pattern for grep), return rest.
 */
export const extractNonFlagArgsAfterFirst = (args: string[]): string[] => {
  const nonFlags = extractNonFlagArgs(args)
  return nonFlags.slice(1)
}

/**
 * Command-specific path extractors.
 * Maps command name to a function that extracts path arguments.
 */
const PATH_EXTRACTORS: Record<string, (args: string[]) => string[]> = {
  cd: (args) => {
    // cd with no args goes to ~
    if (args.length === 0) return ['~']
    // Special case: cd - (previous directory) - check BEFORE filtering
    // since "-" looks like a flag but has special meaning for cd
    if (args[0] === '-' || args.includes('-')) {
      return ['-']
    }
    const filtered = extractNonFlagArgs(args)
    if (filtered.length === 0) return ['~']
    return [filtered[0]]
  },
  ls: (args) => {
    const paths = extractNonFlagArgs(args)
    return paths.length > 0 ? paths : ['.']
  },
  cat: (args) => extractNonFlagArgs(args),
  head: (args) => extractNonFlagArgs(args),
  tail: (args) => extractNonFlagArgs(args),
  find: (args) => {
    // find takes paths before the first flag (-name, -type, etc.)
    const paths: string[] = []
    for (const arg of args) {
      if (arg.startsWith('-')) break
      paths.push(arg)
    }
    return paths.length > 0 ? paths : ['.']
  },
  grep: (args) => {
    // grep [options] pattern [files...]
    // Skip options and pattern, get files
    return extractNonFlagArgsAfterFirst(args)
  },
  rg: (args) => {
    // ripgrep: rg [options] pattern [paths...]
    return extractNonFlagArgsAfterFirst(args)
  },
  tree: (args) => {
    const paths = extractNonFlagArgs(args)
    return paths.length > 0 ? paths : ['.']
  },
  du: (args) => {
    const paths = extractNonFlagArgs(args)
    return paths.length > 0 ? paths : ['.']
  },
  cp: (args) => extractNonFlagArgs(args),
  mv: (args) => extractNonFlagArgs(args),
  rm: (args) => extractNonFlagArgs(args),
  stat: (args) => extractNonFlagArgs(args),
  file: (args) => extractNonFlagArgs(args),
  touch: (args) => extractNonFlagArgs(args),
  mkdir: (args) => extractNonFlagArgs(args),
  rmdir: (args) => extractNonFlagArgs(args),
  ln: (args) => extractNonFlagArgs(args),
  readlink: (args) => extractNonFlagArgs(args),
  realpath: (args) => extractNonFlagArgs(args),
}

/**
 * Extract path arguments from a command using command-specific logic.
 */
export const extractPaths = (command: string): string[] => {
  const tokens = parseCommandTokens(command)
  if (tokens.length === 0) return []

  const cmdName = tokens[0]
  const args = tokens.slice(1)

  const extractor = PATH_EXTRACTORS[cmdName] ?? extractNonFlagArgs
  return extractor(args)
}

// =============================================================================
// Path Matching Utilities
// =============================================================================

/**
 * Match a path or filename against a glob-like pattern.
 * Supports * as wildcard.
 */
export const matchPattern = (value: string, pattern: string): boolean => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  const regex = new RegExp(`^${escaped}$`)
  return regex.test(value)
}

/**
 * Check if a path matches any of the given glob patterns.
 * Checks both the full path segments and basename.
 */
export const matchesExcludePattern = (
  resolvedPath: string,
  patterns: string[]
): string | undefined => {
  const segments = resolvedPath.split('/').filter(Boolean)
  const base = basename(resolvedPath)

  for (const pattern of patterns) {
    // Check basename
    if (matchPattern(base, pattern)) {
      return pattern
    }
    // Check each path segment
    for (const segment of segments) {
      if (matchPattern(segment, pattern)) {
        return pattern
      }
    }
  }
  return undefined
}

/**
 * Check if a resolved path is within a base directory using path.relative().
 * This is more robust than string prefix matching.
 */
export const isPathWithin = (resolvedPath: string, baseDir: string): boolean => {
  const normalizedBase = baseDir.endsWith('/') ? baseDir.slice(0, -1) : baseDir
  const rel = relative(normalizedBase, resolvedPath)
  // Path is within if relative path doesn't start with '..' and isn't absolute
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Check if a resolved path equals or is within a base directory.
 */
export const isPathWithinOrEqual = (resolvedPath: string, baseDir: string): boolean => {
  const normalizedBase = baseDir.endsWith('/') ? baseDir.slice(0, -1) : baseDir
  if (resolvedPath === normalizedBase) return true
  return isPathWithin(resolvedPath, normalizedBase)
}
