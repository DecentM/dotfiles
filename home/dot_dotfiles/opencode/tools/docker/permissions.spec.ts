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
});

// =============================================================================
// getPermissions
// =============================================================================

describe("getPermissions", () => {
  test("loads permissions config", () => {
    const config = getPermissions();
    expect(config).toBeDefined();
    expect(config.rules).toBeInstanceOf(Array);
    expect(config.default).toBe("deny");
  });

  test("returns same instance on multiple calls", () => {
    const config1 = getPermissions();
    const config2 = getPermissions();
    expect(config1).toBe(config2);
  });

  test("has compiled regex on rules", () => {
    const config = getPermissions();
    for (const rule of config.rules) {
      expect(rule.compiledRegex).toBeInstanceOf(RegExp);
    }
  });
});

// =============================================================================
// matchOperation
// =============================================================================

describe("matchOperation", () => {
  describe("read-only operations", () => {
    test("allows container:list", () => {
      const result = matchOperation("container:list");
      expect(result.decision).toBe("allow");
    });

    test("allows container:inspect with any target", () => {
      const result = matchOperation("container:inspect:abc123");
      expect(result.decision).toBe("allow");
    });

    test("allows container:logs with any target", () => {
      const result = matchOperation("container:logs:mycontainer");
      expect(result.decision).toBe("allow");
    });

    test("allows image:list", () => {
      const result = matchOperation("image:list");
      expect(result.decision).toBe("allow");
    });

    test("allows image:inspect with any target", () => {
      const result = matchOperation("image:inspect:node:20");
      expect(result.decision).toBe("allow");
    });

    test("allows volume:list", () => {
      const result = matchOperation("volume:list");
      expect(result.decision).toBe("allow");
    });

    test("allows network:list", () => {
      const result = matchOperation("network:list");
      expect(result.decision).toBe("allow");
    });
  });

  describe("mutating operations", () => {
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
  });

  describe("denied operations", () => {
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

  describe("default behavior", () => {
    test("denies unknown operations", () => {
      const result = matchOperation("unknown:operation");
      expect(result.decision).toBe("deny");
      expect(result.isDefault).toBe(true);
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
  });
});
