/**
 * Tests for the permissions module.
 * Tests command matching against permission patterns.
 */

import { describe, test, expect } from "bun:test";
import { matchCommand } from "./permissions";

// =============================================================================
// matchCommand
// =============================================================================

describe("matchCommand", () => {
  test("matches allowed command", () => {
    const result = matchCommand("ls -la");
    expect(result.decision).toBe("allow");
    expect(result.pattern).not.toBeNull();
  });

  test("matches denied command", () => {
    const result = matchCommand("rm -rf /");
    expect(result.decision).toBe("deny");
  });

  test("returns default deny for unknown command", () => {
    const result = matchCommand("someunknowncommand123");
    expect(result.decision).toBe("deny");
    expect(result.isDefault).toBe(true);
  });

  test("first matching pattern wins", () => {
    // "cd" with no args should be denied (specific rule)
    const cdNoArgs = matchCommand("cd");
    expect(cdNoArgs.decision).toBe("deny");

    // "cd ." should be allowed (cd * pattern)
    const cdDot = matchCommand("cd .");
    expect(cdDot.decision).toBe("allow");
  });

  test("includes rule for constraint checking", () => {
    const result = matchCommand("cat file.txt");
    expect(result.rule).toBeDefined();
  });

  test("trims command before matching", () => {
    const result = matchCommand("  ls -la  ");
    expect(result.decision).toBe("allow");
  });
});
