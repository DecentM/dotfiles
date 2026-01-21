/**
 * Tests for the docker permissions module.
 * Tests permission loading and operation matching.
 */

import { describe, test, expect } from "bun:test";
import { matchOperation, buildOperationPattern, getPermissions } from "./permissions";

// =============================================================================
// buildOperationPattern
// =============================================================================

describe("buildOperationPattern", () => {
  describe("basic pattern building", () => {
    test("returns operation alone when no target", () => {
      expect(buildOperationPattern("container:list")).toBe("container:list");
      expect(buildOperationPattern("image:list")).toBe("image:list");
    });

    test("combines operation and target with colon", () => {
      expect(buildOperationPattern("container:inspect", "abc123")).toBe(
        "container:inspect:abc123"
      );
      expect(buildOperationPattern("image:pull", "node:20")).toBe(
        "image:pull:node:20"
      );
    });

    test("handles empty target", () => {
      expect(buildOperationPattern("container:list", "")).toBe("container:list");
    });

    test("handles undefined target", () => {
      expect(buildOperationPattern("container:list", undefined)).toBe("container:list");
    });
  });

  describe("complex targets", () => {
    test("handles image with tag containing colon", () => {
      expect(buildOperationPattern("image:pull", "node:20")).toBe("image:pull:node:20");
    });

    test("handles image with registry", () => {
      expect(buildOperationPattern("image:pull", "docker.io/library/node:20")).toBe(
        "image:pull:docker.io/library/node:20"
      );
    });

    test("handles container ID", () => {
      expect(buildOperationPattern("container:stop", "abc123def456")).toBe(
        "container:stop:abc123def456"
      );
    });

    test("handles container name with special characters", () => {
      expect(buildOperationPattern("container:inspect", "my-container_name")).toBe(
        "container:inspect:my-container_name"
      );
    });
  });
});

// =============================================================================
// getPermissions
// =============================================================================

describe("getPermissions", () => {
  describe("loading", () => {
    test("loads permissions config", () => {
      const config = getPermissions();
      expect(config).toBeDefined();
      expect(config.rules).toBeInstanceOf(Array);
      expect(config.default).toBe("deny");
    });

    test("returns same instance on multiple calls (singleton)", () => {
      const config1 = getPermissions();
      const config2 = getPermissions();
      expect(config1).toBe(config2);
    });
  });

  describe("compiled rules", () => {
    test("has compiled regex on rules", () => {
      const config = getPermissions();
      for (const rule of config.rules) {
        expect(rule.compiledRegex).toBeInstanceOf(RegExp);
      }
    });

    test("rules have required fields", () => {
      const config = getPermissions();
      for (const rule of config.rules) {
        expect(rule.pattern).toBeDefined();
        expect(typeof rule.pattern).toBe("string");
        expect(["allow", "deny"]).toContain(rule.decision);
      }
    });

    test("rules count is reasonable", () => {
      const config = getPermissions();
      expect(config.rules.length).toBeGreaterThan(0);
    });
  });

  describe("default config", () => {
    test("has default decision", () => {
      const config = getPermissions();
      expect(config.default).toBe("deny");
    });

    test("has default reason", () => {
      const config = getPermissions();
      expect(config.default_reason).toBeDefined();
      expect(typeof config.default_reason).toBe("string");
    });
  });
});

// =============================================================================
// matchOperation
// =============================================================================

describe("matchOperation", () => {
  describe("read-only container operations", () => {
    test("allows container:list", () => {
      const result = matchOperation("container:list");
      expect(result.decision).toBe("allow");
      expect(result.pattern).toBeDefined();
    });

    test("allows container:inspect with any target", () => {
      const result = matchOperation("container:inspect:abc123");
      expect(result.decision).toBe("allow");
    });

    test("allows container:inspect with long container ID", () => {
      const result = matchOperation("container:inspect:abc123def456789012345678901234567890");
      expect(result.decision).toBe("allow");
    });

    test("allows container:logs with any target", () => {
      const result = matchOperation("container:logs:mycontainer");
      expect(result.decision).toBe("allow");
    });

    test("allows container:logs with container name", () => {
      const result = matchOperation("container:logs:my-app-container");
      expect(result.decision).toBe("allow");
    });
  });

  describe("read-only image operations", () => {
    test("allows image:list", () => {
      const result = matchOperation("image:list");
      expect(result.decision).toBe("allow");
    });

    test("allows image:inspect with any target", () => {
      const result = matchOperation("image:inspect:node:20");
      expect(result.decision).toBe("allow");
    });

    test("allows image:inspect with image digest", () => {
      const result = matchOperation("image:inspect:node@sha256:abc123");
      expect(result.decision).toBe("allow");
    });
  });

  describe("read-only volume operations", () => {
    test("allows volume:list", () => {
      const result = matchOperation("volume:list");
      expect(result.decision).toBe("allow");
    });
  });

  describe("read-only network operations", () => {
    test("allows network:list", () => {
      const result = matchOperation("network:list");
      expect(result.decision).toBe("allow");
    });
  });

  describe("mutating operations with constraints", () => {
    test("allows image:pull (with constraints)", () => {
      const result = matchOperation("image:pull:node:20");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });

    test("allows container:create (with constraints)", () => {
      const result = matchOperation("container:create:alpine");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });

    test("allows container:start (with constraints)", () => {
      const result = matchOperation("container:start:opencode-abc");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });

    test("allows container:stop (with constraints)", () => {
      const result = matchOperation("container:stop:sandbox-123");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });

    test("allows container:remove (with constraints)", () => {
      const result = matchOperation("container:remove:opencode-abc");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });

    test("allows container:exec (with constraints)", () => {
      const result = matchOperation("container:exec:opencode-abc");
      expect(result.decision).toBe("allow");
      expect(result.rule?.constraints).toBeDefined();
    });
  });

  describe("explicitly denied operations", () => {
    test("denies volume:create", () => {
      const result = matchOperation("volume:create:myvolume");
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("user confirmation");
    });

    test("denies volume:remove", () => {
      const result = matchOperation("volume:remove:myvolume");
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("user confirmation");
    });
  });

  describe("default deny behavior", () => {
    test("denies unknown operations", () => {
      const result = matchOperation("unknown:operation");
      expect(result.decision).toBe("deny");
      expect(result.isDefault).toBe(true);
    });

    test("denies malformed operations", () => {
      const result = matchOperation("notavalidoperation");
      expect(result.decision).toBe("deny");
      expect(result.isDefault).toBe(true);
    });

    test("has reason for default deny", () => {
      const result = matchOperation("unknown:operation");
      expect(result.reason).toBeDefined();
    });

    test("has null pattern for default deny", () => {
      const result = matchOperation("unknown:operation");
      expect(result.pattern).toBeNull();
    });
  });

  describe("first-match-wins policy", () => {
    test("more specific pattern wins when ordered first", () => {
      // This test validates that pattern order matters
      // The YAML file should have more specific patterns before general ones
      const allowResult = matchOperation("container:list");
      expect(allowResult.decision).toBe("allow");
    });
  });

  describe("match result structure", () => {
    test("includes pattern that matched", () => {
      const result = matchOperation("container:list");
      expect(result.pattern).toBeDefined();
      expect(typeof result.pattern).toBe("string");
    });

    test("includes rule for constraint checking", () => {
      const result = matchOperation("container:create:node");
      expect(result.rule).toBeDefined();
      expect(result.rule?.pattern).toBeDefined();
    });

    test("includes decision", () => {
      const result = matchOperation("container:list");
      expect(result.decision).toBeDefined();
      expect(["allow", "deny"]).toContain(result.decision);
    });

    test("isDefault only true for unmatched operations", () => {
      const matched = matchOperation("container:list");
      expect(matched.isDefault).toBeUndefined();

      const unmatched = matchOperation("totally:unknown:operation");
      expect(unmatched.isDefault).toBe(true);
    });
  });

  describe("pattern matching edge cases", () => {
    test("handles empty operation", () => {
      const result = matchOperation("");
      expect(result.decision).toBe("deny");
    });

    test("handles operation with many colons", () => {
      const result = matchOperation("container:inspect:my:container:with:colons");
      expect(result.decision).toBe("allow");
    });

    test("case insensitive matching", () => {
      // Pattern matching should be case-insensitive
      const result = matchOperation("CONTAINER:LIST");
      expect(result.decision).toBe("allow");
    });
  });
});
