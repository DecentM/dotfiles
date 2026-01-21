/**
 * Tests for the shared permissions validators module.
 * Tests pattern matching and YAML validation utilities.
 */

import { describe, test, expect } from "bun:test";
import {
  simplePatternToRegex,
  createPatternMatcher,
  validateYamlRule,
  validateYamlConfig,
} from "./validators";
import type { PermissionsConfig } from "./types";

// =============================================================================
// simplePatternToRegex
// =============================================================================

describe("simplePatternToRegex", () => {
  describe("exact matching", () => {
    test("matches exact strings", () => {
      const regex = simplePatternToRegex("echo");
      expect(regex.test("echo")).toBe(true);
      expect(regex.test("echoo")).toBe(false);
      expect(regex.test("ech")).toBe(false);
    });

    test("requires full match (not partial)", () => {
      const regex = simplePatternToRegex("ls");
      expect(regex.test("ls")).toBe(true);
      expect(regex.test("lsof")).toBe(false);
      expect(regex.test("als")).toBe(false);
    });

    test("handles empty string pattern", () => {
      const regex = simplePatternToRegex("");
      expect(regex.test("")).toBe(true);
      expect(regex.test("anything")).toBe(false);
    });
  });

  describe("wildcard matching", () => {
    test("matches wildcard at end", () => {
      const regex = simplePatternToRegex("echo*");
      expect(regex.test("echo")).toBe(true);
      expect(regex.test("echo hello")).toBe(true);
      expect(regex.test("echo hello world")).toBe(true);
      expect(regex.test("ech")).toBe(false);
    });

    test("matches wildcard at start", () => {
      const regex = simplePatternToRegex("*.txt");
      expect(regex.test("file.txt")).toBe(true);
      expect(regex.test("another.txt")).toBe(true);
      expect(regex.test("file.json")).toBe(false);
    });

    test("matches wildcard in middle", () => {
      const regex = simplePatternToRegex("cat*file");
      expect(regex.test("catfile")).toBe(true);
      expect(regex.test("cat-some-file")).toBe(true);
      expect(regex.test("cat /path/to/file")).toBe(true);
      expect(regex.test("catfiles")).toBe(false);
    });

    test("matches patterns with multiple wildcards", () => {
      const regex = simplePatternToRegex("*hello*world*");
      expect(regex.test("hello world")).toBe(true);
      expect(regex.test("say hello to the world!")).toBe(true);
      expect(regex.test("hello")).toBe(false);
    });

    test("wildcard matches empty string", () => {
      const regex = simplePatternToRegex("test*");
      expect(regex.test("test")).toBe(true);
    });

    test("standalone wildcard matches anything", () => {
      const regex = simplePatternToRegex("*");
      expect(regex.test("")).toBe(true);
      expect(regex.test("anything at all")).toBe(true);
      expect(regex.test("rm -rf /")).toBe(true);
    });
  });

  describe("special character escaping", () => {
    test("escapes dots", () => {
      const regex = simplePatternToRegex("file.txt");
      expect(regex.test("file.txt")).toBe(true);
      expect(regex.test("filextxt")).toBe(false);
    });

    test("escapes plus signs", () => {
      const regex = simplePatternToRegex("c++");
      expect(regex.test("c++")).toBe(true);
      expect(regex.test("c")).toBe(false);
      expect(regex.test("ccc")).toBe(false);
    });

    test("escapes caret", () => {
      const regex = simplePatternToRegex("^start");
      expect(regex.test("^start")).toBe(true);
      expect(regex.test("start")).toBe(false);
    });

    test("escapes dollar sign", () => {
      const regex = simplePatternToRegex("$var");
      expect(regex.test("$var")).toBe(true);
      expect(regex.test("var")).toBe(false);
    });

    test("escapes curly braces", () => {
      const regex = simplePatternToRegex("{key}");
      expect(regex.test("{key}")).toBe(true);
    });

    test("escapes parentheses", () => {
      const regex = simplePatternToRegex("func(x)");
      expect(regex.test("func(x)")).toBe(true);
    });

    test("escapes pipe", () => {
      const regex = simplePatternToRegex("a|b");
      expect(regex.test("a|b")).toBe(true);
      expect(regex.test("a")).toBe(false);
      expect(regex.test("b")).toBe(false);
    });

    test("escapes brackets", () => {
      const regex = simplePatternToRegex("arr[0]");
      expect(regex.test("arr[0]")).toBe(true);
      expect(regex.test("arr0")).toBe(false);
    });

    test("escapes backslash", () => {
      const regex = simplePatternToRegex("path\\file");
      expect(regex.test("path\\file")).toBe(true);
    });

    test("handles mixed special chars and wildcards", () => {
      const regex = simplePatternToRegex("git log --oneline*");
      expect(regex.test("git log --oneline")).toBe(true);
      expect(regex.test("git log --oneline -n 10")).toBe(true);
    });
  });

  describe("case insensitivity", () => {
    test("is case-insensitive", () => {
      const regex = simplePatternToRegex("echo*");
      expect(regex.test("ECHO hello")).toBe(true);
      expect(regex.test("Echo Hello")).toBe(true);
      expect(regex.test("echo hello")).toBe(true);
    });

    test("case-insensitive for exact patterns", () => {
      const regex = simplePatternToRegex("npm");
      expect(regex.test("NPM")).toBe(true);
      expect(regex.test("Npm")).toBe(true);
      expect(regex.test("npm")).toBe(true);
    });
  });
});

// =============================================================================
// createPatternMatcher
// =============================================================================

describe("createPatternMatcher", () => {
  describe("first-match-wins behavior", () => {
    test("returns first matching pattern", () => {
      const config: PermissionsConfig<void> = {
        rules: [
          {
            pattern: "rm -rf*",
            decision: "deny",
            reason: "Dangerous recursive delete",
            compiledRegex: /^rm -rf.*$/i,
          },
          {
            pattern: "rm*",
            decision: "allow",
            reason: "Allow rm",
            compiledRegex: /^rm.*$/i,
          },
        ],
        default: "deny",
        default_reason: "Not in allowlist",
      };

      const matcher = createPatternMatcher(() => config);

      // "rm -rf /" should match the first (deny) rule
      const dangerousResult = matcher("rm -rf /");
      expect(dangerousResult.decision).toBe("deny");
      expect(dangerousResult.pattern).toBe("rm -rf*");
      expect(dangerousResult.reason).toBe("Dangerous recursive delete");

      // "rm file.txt" should match the second (allow) rule
      const safeResult = matcher("rm file.txt");
      expect(safeResult.decision).toBe("allow");
      expect(safeResult.pattern).toBe("rm*");
    });

    test("order matters - more specific rules should come first", () => {
      const config: PermissionsConfig<void> = {
        rules: [
          {
            pattern: "cd",
            decision: "deny",
            reason: "cd alone goes to home",
            compiledRegex: /^cd$/i,
          },
          {
            pattern: "cd*",
            decision: "allow",
            compiledRegex: /^cd.*$/i,
          },
        ],
        default: "deny",
        default_reason: "Not allowed",
      };

      const matcher = createPatternMatcher(() => config);

      // Exact "cd" matches deny rule
      expect(matcher("cd").decision).toBe("deny");
      // "cd ." matches allow rule
      expect(matcher("cd .").decision).toBe("allow");
    });
  });

  describe("default behavior", () => {
    test("returns config default when no pattern matches", () => {
      const config: PermissionsConfig<void> = {
        rules: [
          {
            pattern: "ls*",
            decision: "allow",
            compiledRegex: /^ls.*$/i,
          },
        ],
        default: "deny",
        default_reason: "Command not in allowlist",
      };

      const matcher = createPatternMatcher(() => config);
      const result = matcher("unknown-command");

      expect(result.decision).toBe("deny");
      expect(result.pattern).toBeNull();
      expect(result.reason).toBe("Command not in allowlist");
      expect(result.isDefault).toBe(true);
    });

    test("default can be allow", () => {
      const config: PermissionsConfig<void> = {
        rules: [
          {
            pattern: "rm -rf*",
            decision: "deny",
            compiledRegex: /^rm -rf.*$/i,
          },
        ],
        default: "allow",
        default_reason: "All commands allowed by default",
      };

      const matcher = createPatternMatcher(() => config);
      const result = matcher("any-command");

      expect(result.decision).toBe("allow");
      expect(result.isDefault).toBe(true);
    });
  });

  describe("constraint pass-through", () => {
    test("includes rule with constraints in result", () => {
      interface TestConstraint {
        type: string;
        value?: string;
      }

      const config: PermissionsConfig<TestConstraint> = {
        rules: [
          {
            pattern: "cat*",
            decision: "allow",
            constraints: [{ type: "cwd_only" }],
            compiledRegex: /^cat.*$/i,
          },
        ],
        default: "deny",
        default_reason: "Not allowed",
      };

      const matcher = createPatternMatcher(() => config);
      const result = matcher("cat file.txt");

      expect(result.decision).toBe("allow");
      expect(result.rule).toBeDefined();
      expect(result.rule?.constraints).toEqual([{ type: "cwd_only" }]);
    });

    test("rule is undefined for default match", () => {
      const config: PermissionsConfig<void> = {
        rules: [],
        default: "deny",
        default_reason: "Not allowed",
      };

      const matcher = createPatternMatcher(() => config);
      const result = matcher("anything");

      expect(result.rule).toBeUndefined();
    });
  });

  describe("dynamic config updates", () => {
    test("re-reads config on each call", () => {
      let callCount = 0;
      const getConfig = (): PermissionsConfig<void> => {
        callCount++;
        return {
          rules: [
            {
              pattern: "echo*",
              decision: callCount === 1 ? "allow" : "deny",
              compiledRegex: /^echo.*$/i,
            },
          ],
          default: "deny",
          default_reason: "Default",
        };
      };

      const matcher = createPatternMatcher(getConfig);

      // First call - allow
      expect(matcher("echo hello").decision).toBe("allow");
      // Second call - deny (config changed)
      expect(matcher("echo hello").decision).toBe("deny");
    });
  });

  describe("edge cases", () => {
    test("handles empty rules array", () => {
      const config: PermissionsConfig<void> = {
        rules: [],
        default: "deny",
        default_reason: "No rules defined",
      };

      const matcher = createPatternMatcher(() => config);
      const result = matcher("any-command");

      expect(result.decision).toBe("deny");
      expect(result.isDefault).toBe(true);
    });

    test("handles empty input string", () => {
      const config: PermissionsConfig<void> = {
        rules: [
          {
            pattern: "",
            decision: "deny",
            reason: "Empty command",
            compiledRegex: /^$/i,
          },
        ],
        default: "allow",
        default_reason: "Default allow",
      };

      const matcher = createPatternMatcher(() => config);
      expect(matcher("").decision).toBe("deny");
    });
  });
});

// =============================================================================
// validateYamlRule
// =============================================================================

describe("validateYamlRule", () => {
  describe("valid rules", () => {
    test("accepts rule with pattern and decision", () => {
      const rule = { pattern: "echo*", decision: "allow" };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });

    test("accepts rule with patterns array and decision", () => {
      const rule = { patterns: ["ls*", "cat*", "echo*"], decision: "allow" };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });

    test("accepts rule with reason", () => {
      const rule = { pattern: "rm*", decision: "deny", reason: "Not allowed" };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });

    test("accepts rule with null reason", () => {
      const rule = { pattern: "test*", decision: "allow", reason: null };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });

    test("accepts rule with undefined reason", () => {
      const rule = { pattern: "test*", decision: "allow", reason: undefined };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });

    test("accepts rule with constraints array", () => {
      const rule = {
        pattern: "cat*",
        decision: "allow",
        constraints: [{ type: "cwd_only" }],
      };
      expect(validateYamlRule(rule, 0)).toBeUndefined();
    });
  });

  describe("invalid rules - not an object", () => {
    test("rejects string rule", () => {
      const error = validateYamlRule("not an object", 5);
      expect(error).toContain("Rule 5");
      expect(error).toContain("Must be an object");
    });

    test("rejects null rule", () => {
      const error = validateYamlRule(null, 0);
      expect(error).toContain("Must be an object");
    });

    test("rejects number rule", () => {
      const error = validateYamlRule(123, 2);
      expect(error).toContain("Rule 2");
      expect(error).toContain("Must be an object");
    });

    test("rejects array rule", () => {
      const error = validateYamlRule(["echo*"], 0);
      // Note: Arrays are technically objects in JS, but they won't have the right fields
      expect(error).toContain("Must have 'pattern'");
    });
  });

  describe("invalid rules - missing pattern", () => {
    test("rejects rule without pattern or patterns", () => {
      const rule = { decision: "allow" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("Must have 'pattern' (string) or 'patterns' (string array)");
    });

    test("rejects rule with non-string pattern", () => {
      const rule = { pattern: 123, decision: "allow" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("Must have 'pattern'");
    });

    test("rejects rule with non-array patterns", () => {
      const rule = { patterns: "not-array", decision: "allow" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("Must have 'pattern'");
    });

    test("rejects rule with patterns containing non-strings", () => {
      const rule = { patterns: ["valid", 123, "also-valid"], decision: "allow" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("Must have 'pattern'");
    });
  });

  describe("invalid rules - invalid decision", () => {
    test("rejects rule with missing decision", () => {
      const rule = { pattern: "echo*" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'decision' must be 'allow' or 'deny'");
    });

    test("rejects rule with invalid decision string", () => {
      const rule = { pattern: "echo*", decision: "maybe" };
      const error = validateYamlRule(rule, 1);
      expect(error).toContain("Rule 1");
      expect(error).toContain("'decision' must be 'allow' or 'deny'");
    });

    test("rejects rule with non-string decision", () => {
      const rule = { pattern: "echo*", decision: true };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'decision' must be 'allow' or 'deny'");
    });
  });

  describe("invalid rules - invalid reason", () => {
    test("rejects rule with non-string reason", () => {
      const rule = { pattern: "echo*", decision: "allow", reason: 123 };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'reason' must be a string or null");
    });

    test("rejects rule with object reason", () => {
      const rule = { pattern: "echo*", decision: "allow", reason: { msg: "test" } };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'reason' must be a string or null");
    });
  });

  describe("invalid rules - invalid constraints", () => {
    test("rejects rule with non-array constraints", () => {
      const rule = { pattern: "echo*", decision: "allow", constraints: "not-array" };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'constraints' must be an array");
    });

    test("rejects rule with object constraints", () => {
      const rule = { pattern: "echo*", decision: "allow", constraints: { type: "cwd_only" } };
      const error = validateYamlRule(rule, 0);
      expect(error).toContain("'constraints' must be an array");
    });
  });

  describe("constraint validation callback", () => {
    test("calls validateConstraints when provided", () => {
      const rule = {
        pattern: "test*",
        decision: "allow",
        constraints: [{ type: "unknown" }],
      };

      const validateConstraints = (constraints: unknown[], ruleIndex: number): string | undefined => {
        const c = constraints[0] as { type: string };
        if (c.type === "unknown") {
          return `Rule ${ruleIndex}: Unknown constraint type '${c.type}'`;
        }
        return undefined;
      };

      const error = validateYamlRule(rule, 3, validateConstraints);
      expect(error).toContain("Rule 3");
      expect(error).toContain("Unknown constraint type");
    });

    test("passes when validateConstraints returns undefined", () => {
      const rule = {
        pattern: "test*",
        decision: "allow",
        constraints: [{ type: "known" }],
      };

      const validateConstraints = (): string | undefined => undefined;

      const error = validateYamlRule(rule, 0, validateConstraints);
      expect(error).toBeUndefined();
    });

    test("skips constraint validation when callback not provided", () => {
      const rule = {
        pattern: "test*",
        decision: "allow",
        constraints: [{ type: "anything-goes" }],
      };

      // No callback provided - should pass
      const error = validateYamlRule(rule, 0);
      expect(error).toBeUndefined();
    });
  });
});

// =============================================================================
// validateYamlConfig
// =============================================================================

describe("validateYamlConfig", () => {
  describe("valid configs", () => {
    test("accepts minimal valid config", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
      };
      expect(validateYamlConfig(config)).toEqual([]);
    });

    test("accepts config with default", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default: "deny",
      };
      expect(validateYamlConfig(config)).toEqual([]);
    });

    test("accepts config with default_reason", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default: "deny",
        default_reason: "Command not in allowlist",
      };
      expect(validateYamlConfig(config)).toEqual([]);
    });

    test("accepts config with multiple rules", () => {
      const config = {
        rules: [
          { pattern: "rm -rf*", decision: "deny", reason: "Dangerous" },
          { patterns: ["ls*", "cat*"], decision: "allow" },
          { pattern: "*", decision: "deny" },
        ],
      };
      expect(validateYamlConfig(config)).toEqual([]);
    });

    test("accepts config with empty rules array", () => {
      const config = { rules: [] };
      expect(validateYamlConfig(config)).toEqual([]);
    });

    test("accepts config with default allow", () => {
      const config = {
        rules: [{ pattern: "rm*", decision: "deny" }],
        default: "allow",
      };
      expect(validateYamlConfig(config)).toEqual([]);
    });
  });

  describe("invalid configs - not an object", () => {
    test("rejects string config", () => {
      const errors = validateYamlConfig("not an object");
      expect(errors).toContain("Config must be an object");
    });

    test("rejects null config", () => {
      const errors = validateYamlConfig(null);
      expect(errors).toContain("Config must be an object");
    });

    test("rejects undefined config", () => {
      const errors = validateYamlConfig(undefined);
      expect(errors).toContain("Config must be an object");
    });

    test("rejects number config", () => {
      const errors = validateYamlConfig(123);
      expect(errors).toContain("Config must be an object");
    });
  });

  describe("invalid configs - missing rules", () => {
    test("rejects config without rules", () => {
      const errors = validateYamlConfig({});
      expect(errors).toContain('Config must have a "rules" array');
    });

    test("rejects config with non-array rules", () => {
      const errors = validateYamlConfig({ rules: "not-array" });
      expect(errors).toContain('Config must have a "rules" array');
    });

    test("rejects config with null rules", () => {
      const errors = validateYamlConfig({ rules: null });
      expect(errors).toContain('Config must have a "rules" array');
    });
  });

  describe("invalid configs - invalid rules", () => {
    test("collects errors from invalid rules", () => {
      const config = {
        rules: [
          { pattern: "valid*", decision: "allow" },
          { decision: "allow" }, // Missing pattern
          { pattern: "test*", decision: "invalid" }, // Invalid decision
        ],
      };
      const errors = validateYamlConfig(config);
      expect(errors.length).toBe(2);
      expect(errors[0]).toContain("Rule 1");
      expect(errors[1]).toContain("Rule 2");
    });

    test("reports all rule errors", () => {
      const config = {
        rules: [
          { decision: "allow" },
          { pattern: 123, decision: "allow" },
          { pattern: "test*" },
        ],
      };
      const errors = validateYamlConfig(config);
      expect(errors.length).toBe(3);
    });
  });

  describe("invalid configs - invalid default", () => {
    test("rejects invalid default value", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default: "maybe",
      };
      const errors = validateYamlConfig(config);
      expect(errors).toContain("'default' must be 'allow' or 'deny'");
    });

    test("rejects non-string default", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default: true,
      };
      const errors = validateYamlConfig(config);
      expect(errors).toContain("'default' must be 'allow' or 'deny'");
    });
  });

  describe("invalid configs - invalid default_reason", () => {
    test("rejects non-string default_reason", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default_reason: 123,
      };
      const errors = validateYamlConfig(config);
      expect(errors).toContain("'default_reason' must be a string");
    });

    test("rejects object default_reason", () => {
      const config = {
        rules: [{ pattern: "echo*", decision: "allow" }],
        default_reason: { message: "test" },
      };
      const errors = validateYamlConfig(config);
      expect(errors).toContain("'default_reason' must be a string");
    });
  });

  describe("constraint validation callback", () => {
    test("passes validateConstraints to rule validation", () => {
      const config = {
        rules: [
          {
            pattern: "test*",
            decision: "allow",
            constraints: [{ type: "invalid" }],
          },
        ],
      };

      const validateConstraints = (
        constraints: unknown[],
        ruleIndex: number
      ): string | undefined => {
        return `Rule ${ruleIndex}: Invalid constraint`;
      };

      const errors = validateYamlConfig(config, validateConstraints);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("Invalid constraint");
    });
  });

  describe("combined errors", () => {
    test("collects all types of errors", () => {
      const config = {
        rules: [
          { decision: "allow" }, // Missing pattern
          { pattern: "test*", decision: "allow" }, // Valid
        ],
        default: "invalid",
        default_reason: 123,
      };
      const errors = validateYamlConfig(config);
      expect(errors.length).toBe(3);
      expect(errors.some((e) => e.includes("Rule 0"))).toBe(true);
      expect(errors.some((e) => e.includes("'default'"))).toBe(true);
      expect(errors.some((e) => e.includes("'default_reason'"))).toBe(true);
    });
  });
});
