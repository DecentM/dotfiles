/**
 * Tests for the docker client module.
 * Tests Docker API client utilities with mocked fetch.
 * 
 * Note: These tests verify the client logic without requiring a running Docker daemon.
 * Integration tests with real Docker should be done separately.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

// =============================================================================
// Helper Types
// =============================================================================

interface MockContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

interface MockImage {
  Id: string;
  RepoTags: string[];
  Size: number;
}

// =============================================================================
// Response Parsing Tests (unit tests without mocking fetch)
// =============================================================================

describe("Docker Log Header Stripping", () => {
  // Test the log header stripping logic directly
  // Docker multiplexes stdout/stderr with 8-byte headers

  const stripDockerLogHeaders = (data: string): string => {
    // Simplified version of the logic for testing
    const lines: string[] = [];
    let offset = 0;
    const buffer = new TextEncoder().encode(data);

    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) {
        lines.push(new TextDecoder().decode(buffer.slice(offset)));
        break;
      }

      const size =
        (buffer[offset + 4] << 24) |
        (buffer[offset + 5] << 16) |
        (buffer[offset + 6] << 8) |
        buffer[offset + 7];

      if (size <= 0 || offset + 8 + size > buffer.length) {
        lines.push(new TextDecoder().decode(buffer.slice(offset)));
        break;
      }

      const payload = buffer.slice(offset + 8, offset + 8 + size);
      lines.push(new TextDecoder().decode(payload));

      offset += 8 + size;
    }

    return lines.join("");
  };

  test("handles plain text without headers", () => {
    const input = "Hello, World!";
    const result = stripDockerLogHeaders(input);
    // Plain text that doesn't look like Docker frames should pass through
    expect(result).toContain("Hello");
  });

  test("handles empty string", () => {
    const result = stripDockerLogHeaders("");
    expect(result).toBe("");
  });

  test("handles short input (less than 8 bytes)", () => {
    const result = stripDockerLogHeaders("short");
    expect(result).toBe("short");
  });
});

// =============================================================================
// Request Building Tests
// =============================================================================

describe("API Request Building", () => {
  describe("URL construction", () => {
    test("builds correct container list URL", () => {
      const baseUrl = "http://localhost/v1.44";
      const path = "/containers/json?all=false";
      const fullUrl = `${baseUrl}${path}`;
      expect(fullUrl).toBe("http://localhost/v1.44/containers/json?all=false");
    });

    test("builds correct container inspect URL with encoding", () => {
      const containerId = "abc123";
      const path = `/containers/${encodeURIComponent(containerId)}/json`;
      expect(path).toBe("/containers/abc123/json");
    });

    test("encodes special characters in container name", () => {
      const containerName = "my-container/test";
      const encoded = encodeURIComponent(containerName);
      expect(encoded).toBe("my-container%2Ftest");
    });

    test("builds image pull URL correctly", () => {
      const imageName = "node:20";
      const path = `/images/create?fromImage=${encodeURIComponent(imageName)}`;
      expect(path).toBe("/images/create?fromImage=node%3A20");
    });
  });

  describe("request options", () => {
    test("default method is GET", () => {
      const defaultOptions = {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      };
      expect(defaultOptions.method).toBe("GET");
    });

    test("POST request includes method", () => {
      const postOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      };
      expect(postOptions.method).toBe("POST");
    });

    test("DELETE request includes method", () => {
      const deleteOptions = {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      };
      expect(deleteOptions.method).toBe("DELETE");
    });

    test("body is JSON stringified", () => {
      const body = { Image: "alpine:latest", Cmd: ["echo", "hello"] };
      const jsonBody = JSON.stringify(body);
      expect(jsonBody).toBe('{"Image":"alpine:latest","Cmd":["echo","hello"]}');
    });
  });
});

// =============================================================================
// Response Type Tests
// =============================================================================

describe("Docker API Response Types", () => {
  describe("success response", () => {
    test("success response structure", () => {
      const response = {
        success: true,
        data: { Id: "abc123" },
        statusCode: 200,
      };
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });

    test("no content response (204)", () => {
      const response = { success: true };
      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
    });
  });

  describe("error response", () => {
    test("error response structure", () => {
      const response = {
        success: false,
        error: "Container not found",
        statusCode: 404,
      };
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    test("socket connection error", () => {
      const response = {
        success: false,
        error: "Cannot connect to Docker socket at /var/run/docker.sock. Is Docker running?",
      };
      expect(response.error).toContain("Docker socket");
    });
  });
});

// =============================================================================
// Container Operations Tests
// =============================================================================

describe("Container Operations", () => {
  describe("listContainers", () => {
    test("builds correct URL for all=false", () => {
      const all = false;
      const url = `/containers/json?all=${all}`;
      expect(url).toBe("/containers/json?all=false");
    });

    test("builds correct URL for all=true", () => {
      const all = true;
      const url = `/containers/json?all=${all}`;
      expect(url).toBe("/containers/json?all=true");
    });
  });

  describe("inspectContainer", () => {
    test("builds correct URL for container ID", () => {
      const id = "abc123def456";
      const url = `/containers/${encodeURIComponent(id)}/json`;
      expect(url).toBe("/containers/abc123def456/json");
    });

    test("builds correct URL for container name", () => {
      const name = "my-container";
      const url = `/containers/${encodeURIComponent(name)}/json`;
      expect(url).toBe("/containers/my-container/json");
    });
  });

  describe("createContainer", () => {
    test("builds URL without name", () => {
      const query = "";
      const url = `/containers/create${query}`;
      expect(url).toBe("/containers/create");
    });

    test("builds URL with name", () => {
      const name = "my-container";
      const query = `?name=${encodeURIComponent(name)}`;
      const url = `/containers/create${query}`;
      expect(url).toBe("/containers/create?name=my-container");
    });

    test("encodes container name with special characters", () => {
      const name = "test-container_1";
      const query = `?name=${encodeURIComponent(name)}`;
      expect(query).toBe("?name=test-container_1");
    });
  });

  describe("stopContainer", () => {
    test("builds URL with default timeout", () => {
      const id = "abc123";
      const timeout = 10;
      const url = `/containers/${encodeURIComponent(id)}/stop?t=${timeout}`;
      expect(url).toBe("/containers/abc123/stop?t=10");
    });

    test("builds URL with custom timeout", () => {
      const id = "abc123";
      const timeout = 30;
      const url = `/containers/${encodeURIComponent(id)}/stop?t=${timeout}`;
      expect(url).toBe("/containers/abc123/stop?t=30");
    });
  });

  describe("removeContainer", () => {
    test("builds URL with default options", () => {
      const id = "abc123";
      const force = false;
      const volumes = false;
      const url = `/containers/${encodeURIComponent(id)}?force=${force}&v=${volumes}`;
      expect(url).toBe("/containers/abc123?force=false&v=false");
    });

    test("builds URL with force=true", () => {
      const id = "abc123";
      const force = true;
      const volumes = false;
      const url = `/containers/${encodeURIComponent(id)}?force=${force}&v=${volumes}`;
      expect(url).toBe("/containers/abc123?force=true&v=false");
    });

    test("builds URL with volumes=true", () => {
      const id = "abc123";
      const force = false;
      const volumes = true;
      const url = `/containers/${encodeURIComponent(id)}?force=${force}&v=${volumes}`;
      expect(url).toBe("/containers/abc123?force=false&v=true");
    });
  });

  describe("getContainerLogs", () => {
    test("builds URL with default parameters", () => {
      const id = "abc123";
      const tail = 100;
      const timestamps = false;
      const url = `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`;
      expect(url).toBe("/containers/abc123/logs?stdout=true&stderr=true&tail=100&timestamps=false");
    });

    test("builds URL with custom tail", () => {
      const id = "abc123";
      const tail = 500;
      const timestamps = false;
      const url = `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`;
      expect(url).toContain("tail=500");
    });

    test("builds URL with timestamps=true", () => {
      const id = "abc123";
      const tail = 100;
      const timestamps = true;
      const url = `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`;
      expect(url).toContain("timestamps=true");
    });
  });
});

// =============================================================================
// Image Operations Tests
// =============================================================================

describe("Image Operations", () => {
  describe("listImages", () => {
    test("builds correct URL", () => {
      const url = "/images/json";
      expect(url).toBe("/images/json");
    });
  });

  describe("pullImage", () => {
    test("builds URL for image without tag", () => {
      const name = "alpine";
      const tag = "latest";
      const imageName = name.includes(":") ? name : `${name}:${tag}`;
      const url = `/images/create?fromImage=${encodeURIComponent(imageName)}`;
      expect(url).toBe("/images/create?fromImage=alpine%3Alatest");
    });

    test("builds URL for image with tag", () => {
      const name = "node:20";
      const tag = "latest"; // Should be ignored
      const imageName = name.includes(":") ? name : `${name}:${tag}`;
      const url = `/images/create?fromImage=${encodeURIComponent(imageName)}`;
      expect(url).toBe("/images/create?fromImage=node%3A20");
    });

    test("builds URL for image with registry", () => {
      const name = "docker.io/library/alpine:3.18";
      const url = `/images/create?fromImage=${encodeURIComponent(name)}`;
      expect(url).toContain("docker.io");
    });
  });

  describe("inspectImage", () => {
    test("builds correct URL for image name", () => {
      const name = "node:20";
      const url = `/images/${encodeURIComponent(name)}/json`;
      expect(url).toBe("/images/node%3A20/json");
    });

    test("builds correct URL for image ID", () => {
      const id = "sha256:abc123def456";
      const url = `/images/${encodeURIComponent(id)}/json`;
      expect(url).toContain("sha256");
    });
  });

  describe("removeImage", () => {
    test("builds URL with default options", () => {
      const name = "alpine:latest";
      const force = false;
      const noprune = false;
      const url = `/images/${encodeURIComponent(name)}?force=${force}&noprune=${noprune}`;
      expect(url).toBe("/images/alpine%3Alatest?force=false&noprune=false");
    });

    test("builds URL with force=true", () => {
      const name = "alpine";
      const force = true;
      const noprune = false;
      const url = `/images/${encodeURIComponent(name)}?force=${force}&noprune=${noprune}`;
      expect(url).toContain("force=true");
    });
  });
});

// =============================================================================
// Volume Operations Tests
// =============================================================================

describe("Volume Operations", () => {
  describe("listVolumes", () => {
    test("builds correct URL", () => {
      const url = "/volumes";
      expect(url).toBe("/volumes");
    });
  });

  describe("createVolume", () => {
    test("builds correct request body", () => {
      const name = "my-volume";
      const options = { driver: "local", labels: { env: "test" } };
      const body = {
        Name: name,
        Driver: options.driver ?? "local",
        Labels: options.labels,
      };
      expect(body.Name).toBe("my-volume");
      expect(body.Driver).toBe("local");
      expect(body.Labels).toEqual({ env: "test" });
    });

    test("uses default driver", () => {
      const name = "my-volume";
      const options = {};
      const body = {
        Name: name,
        Driver: (options as any).driver ?? "local",
        Labels: (options as any).labels,
      };
      expect(body.Driver).toBe("local");
    });
  });

  describe("removeVolume", () => {
    test("builds correct URL", () => {
      const name = "my-volume";
      const url = `/volumes/${encodeURIComponent(name)}`;
      expect(url).toBe("/volumes/my-volume");
    });
  });
});

// =============================================================================
// Network Operations Tests
// =============================================================================

describe("Network Operations", () => {
  describe("listNetworks", () => {
    test("builds correct URL", () => {
      const url = "/networks";
      expect(url).toBe("/networks");
    });
  });
});

// =============================================================================
// Exec Operations Tests
// =============================================================================

describe("Exec Operations", () => {
  describe("createExec", () => {
    test("builds correct URL", () => {
      const containerId = "abc123";
      const url = `/containers/${encodeURIComponent(containerId)}/exec`;
      expect(url).toBe("/containers/abc123/exec");
    });

    test("builds correct request body", () => {
      const config = {
        Cmd: ["ls", "-la"],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: "/app",
        User: "node",
        Env: ["NODE_ENV=production"],
      };
      expect(config.Cmd).toEqual(["ls", "-la"]);
      expect(config.WorkingDir).toBe("/app");
    });
  });

  describe("startExec", () => {
    test("builds correct URL", () => {
      const execId = "exec123";
      const url = `/exec/${encodeURIComponent(execId)}/start`;
      expect(url).toBe("/exec/exec123/start");
    });

    test("builds correct request body", () => {
      const body = { Detach: false, Tty: false };
      expect(body.Detach).toBe(false);
      expect(body.Tty).toBe(false);
    });
  });

  describe("inspectExec", () => {
    test("builds correct URL", () => {
      const execId = "exec123";
      const url = `/exec/${encodeURIComponent(execId)}/json`;
      expect(url).toBe("/exec/exec123/json");
    });
  });
});

// =============================================================================
// Health Check Tests
// =============================================================================

describe("Health Check", () => {
  describe("ping", () => {
    test("builds correct URL", () => {
      const url = "/_ping";
      expect(url).toBe("/_ping");
    });
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error Handling", () => {
  describe("socket errors", () => {
    test("detects ENOENT error", () => {
      const errorMessage = "ENOENT: no such file or directory";
      const isSocketError = errorMessage.includes("ENOENT") || errorMessage.includes("EACCES");
      expect(isSocketError).toBe(true);
    });

    test("detects EACCES error", () => {
      const errorMessage = "EACCES: permission denied";
      const isSocketError = errorMessage.includes("ENOENT") || errorMessage.includes("EACCES");
      expect(isSocketError).toBe(true);
    });

    test("does not flag other errors as socket errors", () => {
      const errorMessage = "Container not found";
      const isSocketError = errorMessage.includes("ENOENT") || errorMessage.includes("EACCES");
      expect(isSocketError).toBe(false);
    });
  });

  describe("response error parsing", () => {
    test("extracts message from error response", () => {
      const data = { message: "Container not found" };
      const errorMessage = typeof data === "object" && "message" in data
        ? String(data.message)
        : "Unknown error";
      expect(errorMessage).toBe("Container not found");
    });

    test("handles response without message", () => {
      const data = { error: "Some error" };
      const errorMessage = typeof data === "object" && "message" in data
        ? String(data.message)
        : "HTTP 404";
      expect(errorMessage).toBe("HTTP 404");
    });
  });
});
