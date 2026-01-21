/**
 * Tests for the docker validators module.
 * Tests constraint validation functions.
 */

import { describe, test, expect } from "bun:test";
import {
  patternToRegex,
  matchesAnyPattern,
  validateNoPrivileged,
  validateNoHostNetwork,
  validateAllowedMounts,
  validateImagePattern,
  validateContainerPattern,
  validateResourceLimits,
  validateConstraints,
} from "./validators";
import type { ContainerConfig, PermissionPattern } from "./types";

// =============================================================================
// patternToRegex
// =============================================================================

describe("patternToRegex", () => {
  test("matches exact strings", () => {
    const regex = patternToRegex("container:list");
    expect(regex.test("container:list")).toBe(true);
    expect(regex.test("container:inspect")).toBe(false);
  });

  test("matches wildcard patterns", () => {
    const regex = patternToRegex("container:*");
    expect(regex.test("container:list")).toBe(true);
    expect(regex.test("container:inspect")).toBe(true);
    expect(regex.test("container:create:node")).toBe(true);
    expect(regex.test("image:list")).toBe(false);
  });

  test("matches patterns with multiple wildcards", () => {
    const regex = patternToRegex("*:*");
    expect(regex.test("container:list")).toBe(true);
    expect(regex.test("image:pull")).toBe(true);
  });

  test("escapes special regex characters", () => {
    const regex = patternToRegex("node:20.0");
    expect(regex.test("node:20.0")).toBe(true);
    expect(regex.test("node:2000")).toBe(false);
  });

  test("is case-insensitive", () => {
    const regex = patternToRegex("alpine:*");
    expect(regex.test("ALPINE:latest")).toBe(true);
    expect(regex.test("Alpine:3.18")).toBe(true);
  });
});

// =============================================================================
// matchesAnyPattern
// =============================================================================

describe("matchesAnyPattern", () => {
  test("matches when any pattern matches", () => {
    const patterns = ["node:*", "python:*", "alpine:*"];
    expect(matchesAnyPattern("node:20", patterns)).toBe(true);
    expect(matchesAnyPattern("python:3.11", patterns)).toBe(true);
    expect(matchesAnyPattern("alpine:latest", patterns)).toBe(true);
  });

  test("returns false when no patterns match", () => {
    const patterns = ["node:*", "python:*"];
    expect(matchesAnyPattern("ubuntu:22.04", patterns)).toBe(false);
    expect(matchesAnyPattern("redis:7", patterns)).toBe(false);
  });

  test("handles empty patterns array", () => {
    expect(matchesAnyPattern("anything", [])).toBe(false);
  });
});

// =============================================================================
// validateNoPrivileged
// =============================================================================

describe("validateNoPrivileged", () => {
  test("allows non-privileged containers", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Privileged: false,
      },
    };
    const result = validateNoPrivileged(config);
    expect(result.valid).toBe(true);
  });

  test("allows containers without HostConfig", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
    };
    const result = validateNoPrivileged(config);
    expect(result.valid).toBe(true);
  });

  test("denies privileged containers", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Privileged: true,
      },
    };
    const result = validateNoPrivileged(config);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("Privileged containers");
  });
});

// =============================================================================
// validateNoHostNetwork
// =============================================================================

describe("validateNoHostNetwork", () => {
  test("allows bridge network mode", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        NetworkMode: "bridge",
      },
    };
    const result = validateNoHostNetwork(config);
    expect(result.valid).toBe(true);
  });

  test("allows containers without NetworkMode", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
    };
    const result = validateNoHostNetwork(config);
    expect(result.valid).toBe(true);
  });

  test("denies host network mode", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        NetworkMode: "host",
      },
    };
    const result = validateNoHostNetwork(config);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("Host network mode");
  });
});

// =============================================================================
// validateAllowedMounts
// =============================================================================

describe("validateAllowedMounts", () => {
  const allowedPatterns = ["/tmp/*", "/home/*/code/*"];

  test("allows mounts within allowed paths", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Binds: ["/tmp/data:/data"],
      },
    };
    const result = validateAllowedMounts(config, allowedPatterns);
    expect(result.valid).toBe(true);
  });

  test("allows containers without mounts", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
    };
    const result = validateAllowedMounts(config, allowedPatterns);
    expect(result.valid).toBe(true);
  });

  test("denies mounts outside allowed paths", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Binds: ["/etc/passwd:/etc/passwd:ro"],
      },
    };
    const result = validateAllowedMounts(config, allowedPatterns);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("not in allowed paths");
  });

  test("allows multiple valid mounts", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Binds: ["/tmp/a:/a", "/tmp/b:/b"],
      },
    };
    const result = validateAllowedMounts(config, allowedPatterns);
    expect(result.valid).toBe(true);
  });

  test("denies if any mount is invalid", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Binds: ["/tmp/valid:/valid", "/etc/invalid:/invalid"],
      },
    };
    const result = validateAllowedMounts(config, allowedPatterns);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// validateImagePattern
// =============================================================================

describe("validateImagePattern", () => {
  const allowedPatterns = ["node:*", "python:*", "opencode/*"];

  test("allows images matching patterns", () => {
    expect(validateImagePattern("node:20", allowedPatterns).valid).toBe(true);
    expect(validateImagePattern("node:latest", allowedPatterns).valid).toBe(true);
    expect(validateImagePattern("python:3.11", allowedPatterns).valid).toBe(true);
    expect(validateImagePattern("opencode/sandbox", allowedPatterns).valid).toBe(true);
  });

  test("denies images not matching patterns", () => {
    const result = validateImagePattern("ubuntu:22.04", allowedPatterns);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("not in allowed patterns");
  });
});

// =============================================================================
// validateContainerPattern
// =============================================================================

describe("validateContainerPattern", () => {
  const allowedPatterns = ["opencode-*", "sandbox-*", "test-*"];

  test("allows containers matching patterns", () => {
    expect(validateContainerPattern("opencode-abc123", allowedPatterns).valid).toBe(true);
    expect(validateContainerPattern("sandbox-dev", allowedPatterns).valid).toBe(true);
    expect(validateContainerPattern("test-unit", allowedPatterns).valid).toBe(true);
  });

  test("strips leading slash from container name", () => {
    expect(validateContainerPattern("/opencode-abc", allowedPatterns).valid).toBe(true);
  });

  test("denies containers not matching patterns", () => {
    const result = validateContainerPattern("production-app", allowedPatterns);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("not in allowed patterns");
  });
});

// =============================================================================
// validateResourceLimits
// =============================================================================

describe("validateResourceLimits", () => {
  test("allows containers within memory limits", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Memory: 256 * 1024 * 1024, // 256MB
      },
    };
    const result = validateResourceLimits(config, "512m", undefined);
    expect(result.valid).toBe(true);
  });

  test("denies containers exceeding memory limits", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        Memory: 2 * 1024 * 1024 * 1024, // 2GB
      },
    };
    const result = validateResourceLimits(config, "512m", undefined);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("Memory limit");
  });

  test("allows containers within CPU limits", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        NanoCpus: 1e9, // 1 CPU
      },
    };
    const result = validateResourceLimits(config, undefined, 2);
    expect(result.valid).toBe(true);
  });

  test("denies containers exceeding CPU limits", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
      HostConfig: {
        NanoCpus: 4e9, // 4 CPUs
      },
    };
    const result = validateResourceLimits(config, undefined, 2);
    expect(result.valid).toBe(false);
    expect(result.violation).toContain("CPU limit");
  });

  test("allows containers without resource config", () => {
    const config: ContainerConfig = {
      Image: "alpine:latest",
    };
    const result = validateResourceLimits(config, "512m", 2);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// validateConstraints
// =============================================================================

describe("validateConstraints", () => {
  describe("with no constraints", () => {
    test("allows operation when rule has no constraints", () => {
      const rule: PermissionPattern = {
        pattern: "container:list",
        decision: "allow",
      };
      const result = validateConstraints(rule, {});
      expect(result.valid).toBe(true);
    });
  });

  describe("with single constraint (string shorthand)", () => {
    test("validates no_privileged constraint", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: ["no_privileged"],
      };

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { Privileged: false },
        },
      });
      expect(allowed.valid).toBe(true);

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { Privileged: true },
        },
      });
      expect(denied.valid).toBe(false);
    });

    test("validates no_host_network constraint", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: ["no_host_network"],
      };

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { NetworkMode: "bridge" },
        },
      });
      expect(allowed.valid).toBe(true);

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { NetworkMode: "host" },
        },
      });
      expect(denied.valid).toBe(false);
    });
  });

  describe("with single constraint (object form)", () => {
    test("validates image_pattern constraint", () => {
      const rule: PermissionPattern = {
        pattern: "image:pull:*",
        decision: "allow",
        constraints: [
          {
            type: "image_pattern",
            value: ["node:*", "python:*"],
          },
        ],
      };

      const allowed = validateConstraints(rule, {
        imageName: "node:20",
      });
      expect(allowed.valid).toBe(true);

      const denied = validateConstraints(rule, {
        imageName: "ubuntu:22.04",
      });
      expect(denied.valid).toBe(false);
    });

    test("validates container_pattern constraint", () => {
      const rule: PermissionPattern = {
        pattern: "container:stop:*",
        decision: "allow",
        constraints: [
          {
            type: "container_pattern",
            value: ["opencode-*", "sandbox-*"],
          },
        ],
      };

      const allowed = validateConstraints(rule, {
        containerName: "opencode-abc123",
      });
      expect(allowed.valid).toBe(true);

      const denied = validateConstraints(rule, {
        containerName: "production-app",
      });
      expect(denied.valid).toBe(false);
    });

    test("validates allowed_mounts constraint", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: [
          {
            type: "allowed_mounts",
            value: ["/tmp/*"],
          },
        ],
      };

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { Binds: ["/tmp/data:/data"] },
        },
      });
      expect(allowed.valid).toBe(true);

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: { Binds: ["/etc/passwd:/etc/passwd"] },
        },
      });
      expect(denied.valid).toBe(false);
    });

    test("validates resource_limits constraint", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: [
          {
            type: "resource_limits",
            max_memory: "512m",
            max_cpus: 2,
          },
        ],
      };

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: {
            Memory: 256 * 1024 * 1024,
            NanoCpus: 1e9,
          },
        },
      });
      expect(allowed.valid).toBe(true);

      const deniedMemory = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: {
            Memory: 2 * 1024 * 1024 * 1024,
          },
        },
      });
      expect(deniedMemory.valid).toBe(false);
    });
  });

  describe("with multiple constraints", () => {
    test("all constraints must pass", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: ["no_privileged", "no_host_network"],
      };

      // Both pass
      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: {
            Privileged: false,
            NetworkMode: "bridge",
          },
        },
      });
      expect(allowed.valid).toBe(true);

      // no_privileged fails
      const deniedPrivileged = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: {
            Privileged: true,
            NetworkMode: "bridge",
          },
        },
      });
      expect(deniedPrivileged.valid).toBe(false);

      // no_host_network fails
      const deniedNetwork = validateConstraints(rule, {
        containerConfig: {
          Image: "alpine:latest",
          HostConfig: {
            Privileged: false,
            NetworkMode: "host",
          },
        },
      });
      expect(deniedNetwork.valid).toBe(false);
    });

    test("mixed constraint formats work together", () => {
      const rule: PermissionPattern = {
        pattern: "container:create:*",
        decision: "allow",
        constraints: [
          "no_privileged",
          {
            type: "image_pattern",
            value: ["node:*", "python:*"],
          },
          {
            type: "allowed_mounts",
            value: ["/tmp/*"],
          },
        ],
      };

      // All pass
      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: "node:20",
          HostConfig: {
            Privileged: false,
            Binds: ["/tmp/data:/data"],
          },
        },
        imageName: "node:20",
      });
      expect(allowed.valid).toBe(true);

      // Image pattern fails
      const deniedImage = validateConstraints(rule, {
        containerConfig: {
          Image: "ubuntu:22.04",
          HostConfig: {
            Privileged: false,
            Binds: ["/tmp/data:/data"],
          },
        },
        imageName: "ubuntu:22.04",
      });
      expect(deniedImage.valid).toBe(false);
    });
  });

  describe("error handling", () => {
    test("errors on unknown constraint type", () => {
      const rule: PermissionPattern = {
        pattern: "test:*",
        decision: "allow",
        constraints: ["unknown_constraint" as any],
      };
      const result = validateConstraints(rule, {});
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("Unknown constraint type");
    });
  });
});
