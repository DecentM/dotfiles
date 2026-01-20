/**
 * OpenCode Permission Audit Plugin - Command Hierarchy Builder
 *
 * Parses bash commands into a hierarchical tree structure and calculates
 * denial statistics at each level.
 */

import type { AuditDatabase } from "./database";
import type { HierarchyNode, HierarchyRow, ParsedCommand } from "./types";

/**
 * Parse a bash command into its hierarchical segments
 *
 * Examples:
 *   "npm run build" -> ["npm", "npm run", "npm run build"]
 *   "git commit -m 'message'" -> ["git", "git commit"]
 *   "docker compose up -d" -> ["docker", "docker compose", "docker compose up"]
 */
export const parseCommand = (command: string): ParsedCommand => {
  // Normalize whitespace
  const normalized = command.trim().replace(/\s+/g, " ");

  // Split by space, but respect quotes
  const tokens = tokenize(normalized);

  if (tokens.length === 0) {
    return { full: command, segments: [], base: "" };
  }

  const segments: string[] = [];
  const base = tokens[0];

  // Build cumulative segments, stopping at flags or special characters
  let current = base;
  segments.push(current);

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Stop adding to hierarchy when we hit:
    // - Flags (starting with -)
    // - Pipes, redirects, etc.
    // - Quoted strings (likely arguments)
    if (
      token.startsWith("-") ||
      token.startsWith("|") ||
      token.startsWith(">") ||
      token.startsWith("<") ||
      token.startsWith("&") ||
      token.startsWith(";") ||
      token.startsWith("'") ||
      token.startsWith('"') ||
      token.startsWith("$") ||
      token.startsWith("(") ||
      // Also stop at path-like arguments
      token.includes("/") ||
      token.includes(".")
    ) {
      break;
    }

    current = `${current} ${token}`;
    segments.push(current);
  }

  return {
    full: normalized,
    segments,
    base,
  };
};

/**
 * Tokenize a command string, respecting quotes
 */
const tokenize = (cmd: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (inQuote) {
      current += char;
      if (char === inQuote) {
        inQuote = null;
      }
    } else if (char === '"' || char === "'") {
      current += char;
      inQuote = char;
    } else if (char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
};

/**
 * Determine if a permission was denied
 */
const isDenied = (
  initialStatus: string,
  userResponse: string | null
): boolean => {
  return initialStatus === "deny" || userResponse === "reject";
};

/**
 * Determine if a permission was allowed
 */
const isAllowed = (
  initialStatus: string,
  userResponse: string | null
): boolean => {
  return (
    initialStatus === "allow" ||
    userResponse === "once" ||
    userResponse === "always"
  );
};

/**
 * Determine if a permission was asked (prompted user)
 */
const isAsked = (
  initialStatus: string,
  userResponse: string | null
): boolean => {
  return initialStatus === "ask" && userResponse !== null;
};

/**
 * Build hierarchy from database
 */
export const buildHierarchy = (db: AuditDatabase): HierarchyRow[] => {
  const patterns = db.getBashPatterns();

  // Aggregate counts per command segment
  const commandStats = new Map<
    string,
    {
      parent: string | null;
      level: number;
      total: number;
      denied: number;
      asked: number;
      allowed: number;
      lastSeen: number;
    }
  >();

  for (const entry of patterns) {
    // Handle array patterns (multiple commands in one permission)
    let commandPatterns: string[];
    try {
      const parsed = JSON.parse(entry.pattern);
      commandPatterns = Array.isArray(parsed) ? parsed : [entry.pattern];
    } catch {
      commandPatterns = [entry.pattern];
    }

    for (const pattern of commandPatterns) {
      const parsed = parseCommand(pattern);

      for (let i = 0; i < parsed.segments.length; i++) {
        const segment = parsed.segments[i];
        const parent = i > 0 ? parsed.segments[i - 1] : null;
        const level = i;

        const existing = commandStats.get(segment) || {
          parent,
          level,
          total: 0,
          denied: 0,
          asked: 0,
          allowed: 0,
          lastSeen: 0,
        };

        existing.total++;
        existing.lastSeen = Math.max(existing.lastSeen, entry.createdAt);

        if (isDenied(entry.initialStatus, entry.userResponse)) {
          existing.denied++;
        }
        if (isAllowed(entry.initialStatus, entry.userResponse)) {
          existing.allowed++;
        }
        if (isAsked(entry.initialStatus, entry.userResponse)) {
          existing.asked++;
        }

        commandStats.set(segment, existing);
      }
    }
  }

  // Convert to HierarchyRow array
  const rows: HierarchyRow[] = [];

  for (const [command, stats] of commandStats) {
    rows.push({
      command,
      parent: stats.parent,
      level: stats.level,
      total_count: stats.total,
      denied_count: stats.denied,
      asked_count: stats.asked,
      allowed_count: stats.allowed,
      denial_rate: stats.total > 0 ? stats.denied / stats.total : 0,
      last_seen: stats.lastSeen,
    });
  }

  return rows;
};

/**
 * Convert flat hierarchy rows to tree structure
 */
export const buildTree = (rows: HierarchyRow[]): HierarchyNode[] => {
  // Create nodes map
  const nodeMap = new Map<string, HierarchyNode>();

  for (const row of rows) {
    nodeMap.set(row.command, {
      command: row.command,
      level: row.level,
      totalCount: row.total_count,
      deniedCount: row.denied_count,
      askedCount: row.asked_count,
      allowedCount: row.allowed_count,
      denialRate: row.denial_rate,
      children: [],
      lastSeen: row.last_seen,
    });
  }

  // Build parent-child relationships
  const roots: HierarchyNode[] = [];

  for (const row of rows) {
    const node = nodeMap.get(row.command)!;

    if (row.parent && nodeMap.has(row.parent)) {
      nodeMap.get(row.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort all levels by denial rate (descending)
  const sortByDenialRate = (nodes: HierarchyNode[]): void => {
    nodes.sort((a, b) => {
      // Primary sort: denial rate descending
      if (b.denialRate !== a.denialRate) {
        return b.denialRate - a.denialRate;
      }
      // Secondary sort: total count descending
      return b.totalCount - a.totalCount;
    });

    for (const node of nodes) {
      sortByDenialRate(node.children);
    }
  };

  sortByDenialRate(roots);

  return roots;
};

/**
 * Format hierarchy as ASCII tree
 */
export const formatHierarchy = (
  nodes: HierarchyNode[],
  options: {
    maxDepth?: number;
    minDenialRate?: number;
    showCounts?: boolean;
  } = {}
): string => {
  const { maxDepth = Infinity, minDenialRate = 0, showCounts = true } = options;

  const lines: string[] = [];

  const formatNode = (
    node: HierarchyNode,
    prefix: string,
    isLast: boolean,
    depth: number
  ): void => {
    if (depth > maxDepth) return;
    if (node.denialRate < minDenialRate && depth > 0) return;

    const connector = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
    const denialPct = (node.denialRate * 100).toFixed(0);

    let line = `${prefix}${connector}${node.command}`;

    if (showCounts) {
      line += ` (denied: ${node.deniedCount}/${node.totalCount}, ${denialPct}%)`;
    }

    lines.push(line);

    const newPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");

    const filteredChildren = node.children.filter(
      (child) => child.denialRate >= minDenialRate || depth < maxDepth - 1
    );

    for (let i = 0; i < filteredChildren.length; i++) {
      formatNode(
        filteredChildren[i],
        newPrefix,
        i === filteredChildren.length - 1,
        depth + 1
      );
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    formatNode(nodes[i], "", i === nodes.length - 1, 0);
  }

  return lines.join("\n");
};

/**
 * Rebuild and save hierarchy to database
 */
export const rebuildHierarchy = (db: AuditDatabase): HierarchyNode[] => {
  const rows = buildHierarchy(db);
  db.saveHierarchy(rows);
  return buildTree(rows);
};

/**
 * Get hierarchy from cache or rebuild
 */
export const getHierarchy = (
  db: AuditDatabase,
  forceRebuild = false
): HierarchyNode[] => {
  if (forceRebuild) {
    return rebuildHierarchy(db);
  }

  const cached = db.getHierarchyCache();

  if (cached.length === 0) {
    return rebuildHierarchy(db);
  }

  return buildTree(cached);
};
