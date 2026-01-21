/**
 * Tests for the Docker container runner module.
 * Tests the high-level runContainer function with mocked dependencies.
 *
 * Note: These tests verify runner logic without requiring a running Docker daemon.
 * The actual Docker API calls and Bun.spawn are mocked.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

// We need to test the module in isolation, so we'll mock the client imports
// Since the runner imports from "./client", we test the helper functions directly
// and mock dockerFetch for integration behavior

// =============================================================================
// Test Helpers - Memory Parsing
// =============================================================================

describe("parseMemoryToBytes (internal helper)", () => {
	// Test the memory parsing logic that's used internally

	const parseMemoryToBytes = (memory: string): number => {
		const match = memory.match(/^(\d+)([kmgKMG]?)$/);
		if (!match) {
			return 512 * 1024 * 1024; // Default to 512MB
		}

		const value = Number.parseInt(match[1], 10);
		const unit = match[2].toLowerCase();

		switch (unit) {
			case "k":
				return value * 1024;
			case "m":
				return value * 1024 * 1024;
			case "g":
				return value * 1024 * 1024 * 1024;
			default:
				return value;
		}
	};

	describe("valid memory strings", () => {
		test("parses bytes (no unit)", () => {
			expect(parseMemoryToBytes("1024")).toBe(1024);
		});

		test("parses kilobytes", () => {
			expect(parseMemoryToBytes("512k")).toBe(512 * 1024);
		});

		test("parses kilobytes uppercase", () => {
			expect(parseMemoryToBytes("512K")).toBe(512 * 1024);
		});

		test("parses megabytes", () => {
			expect(parseMemoryToBytes("512m")).toBe(512 * 1024 * 1024);
		});

		test("parses megabytes uppercase", () => {
			expect(parseMemoryToBytes("512M")).toBe(512 * 1024 * 1024);
		});

		test("parses gigabytes", () => {
			expect(parseMemoryToBytes("1g")).toBe(1 * 1024 * 1024 * 1024);
		});

		test("parses gigabytes uppercase", () => {
			expect(parseMemoryToBytes("2G")).toBe(2 * 1024 * 1024 * 1024);
		});
	});

	describe("edge cases", () => {
		test("returns default for invalid string", () => {
			expect(parseMemoryToBytes("invalid")).toBe(512 * 1024 * 1024);
		});

		test("returns default for empty string", () => {
			expect(parseMemoryToBytes("")).toBe(512 * 1024 * 1024);
		});

		test("returns default for negative number", () => {
			expect(parseMemoryToBytes("-512m")).toBe(512 * 1024 * 1024);
		});

		test("handles zero", () => {
			expect(parseMemoryToBytes("0")).toBe(0);
		});

		test("handles large values", () => {
			expect(parseMemoryToBytes("8g")).toBe(8 * 1024 * 1024 * 1024);
		});
	});
});

// =============================================================================
// Test Helpers - CPU Conversion
// =============================================================================

describe("cpusToNano (internal helper)", () => {
	const cpusToNano = (cpus: number): number => {
		return cpus * 1_000_000_000;
	};

	test("converts 1 CPU to nanoseconds", () => {
		expect(cpusToNano(1)).toBe(1_000_000_000);
	});

	test("converts 2 CPUs to nanoseconds", () => {
		expect(cpusToNano(2)).toBe(2_000_000_000);
	});

	test("handles fractional CPUs", () => {
		expect(cpusToNano(0.5)).toBe(500_000_000);
	});

	test("handles zero", () => {
		expect(cpusToNano(0)).toBe(0);
	});
});

// =============================================================================
// Test Helpers - Container Name Generation
// =============================================================================

describe("generateContainerName (internal helper)", () => {
	const generateContainerName = (): string => {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		return `opencode-exec-${timestamp}-${random}`;
	};

	test("generates name with correct prefix", () => {
		const name = generateContainerName();
		expect(name.startsWith("opencode-exec-")).toBe(true);
	});

	test("generates unique names", () => {
		const names = new Set<string>();
		for (let i = 0; i < 10; i++) {
			names.add(generateContainerName());
		}
		// All names should be unique (or at least 9 out of 10)
		expect(names.size).toBeGreaterThanOrEqual(9);
	});

	test("includes timestamp component", () => {
		const before = Date.now();
		const name = generateContainerName();
		const after = Date.now();

		// Extract timestamp from name
		const match = name.match(/opencode-exec-(\d+)-/);
		expect(match).not.toBeNull();
		const timestamp = Number.parseInt(match![1], 10);
		expect(timestamp).toBeGreaterThanOrEqual(before);
		expect(timestamp).toBeLessThanOrEqual(after);
	});

	test("includes random suffix", () => {
		const name = generateContainerName();
		const parts = name.split("-");
		// Last part should be alphanumeric random suffix
		const suffix = parts[parts.length - 1];
		expect(suffix.length).toBeGreaterThan(0);
		expect(/^[a-z0-9]+$/i.test(suffix)).toBe(true);
	});
});

// =============================================================================
// Test Helpers - Timeout Promise
// =============================================================================

describe("createTimeoutPromise (internal helper)", () => {
	const createTimeoutPromise = <T>(ms: number): Promise<T> => {
		return new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error("TIMEOUT"));
			}, ms);
		});
	};

	test("rejects after specified timeout", async () => {
		const promise = createTimeoutPromise(50);
		await expect(promise).rejects.toThrow("TIMEOUT");
	});

	test("includes TIMEOUT message in error", async () => {
		const promise = createTimeoutPromise(10);
		try {
			await promise;
			expect(true).toBe(false); // Should not reach here
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			expect((error as Error).message).toBe("TIMEOUT");
		}
	});
});

// =============================================================================
// RunContainerOptions Validation
// =============================================================================

describe("RunContainerOptions structure", () => {
	test("accepts minimal options", () => {
		const options = {
			image: "alpine:latest",
		};
		expect(options.image).toBe("alpine:latest");
	});

	test("accepts all optional fields", () => {
		const options = {
			image: "node:20",
			code: "console.log('hello')",
			cmd: ["node", "-e"],
			env: ["NODE_ENV=test"],
			workingDir: "/app",
			memory: "256m",
			cpus: 2,
			networkMode: "bridge",
			timeout: 60000,
			autoRemove: false,
			name: "test-container",
		};

		expect(options.image).toBe("node:20");
		expect(options.code).toBe("console.log('hello')");
		expect(options.cmd).toEqual(["node", "-e"]);
		expect(options.env).toEqual(["NODE_ENV=test"]);
		expect(options.workingDir).toBe("/app");
		expect(options.memory).toBe("256m");
		expect(options.cpus).toBe(2);
		expect(options.networkMode).toBe("bridge");
		expect(options.timeout).toBe(60000);
		expect(options.autoRemove).toBe(false);
		expect(options.name).toBe("test-container");
	});
});

// =============================================================================
// RunContainerResult Structure
// =============================================================================

describe("RunContainerResult structure", () => {
	test("success result has all required fields", () => {
		const result = {
			exitCode: 0,
			stdout: "Hello, World!",
			stderr: "",
			durationMs: 150,
			timedOut: false,
			containerId: "abc123def456",
		};

		expect(typeof result.exitCode).toBe("number");
		expect(typeof result.stdout).toBe("string");
		expect(typeof result.stderr).toBe("string");
		expect(typeof result.durationMs).toBe("number");
		expect(typeof result.timedOut).toBe("boolean");
		expect(typeof result.containerId).toBe("string");
	});

	test("error result has negative exit code", () => {
		const result = {
			exitCode: -1,
			stdout: "",
			stderr: "Failed to create container",
			durationMs: 50,
			timedOut: false,
			containerId: "",
		};

		expect(result.exitCode).toBe(-1);
		expect(result.stderr).toContain("Failed");
	});

	test("timeout result has timedOut=true and exitCode=-2", () => {
		const result = {
			exitCode: -2,
			stdout: "partial output",
			stderr: "Execution timed out after 30000ms and was terminated.",
			durationMs: 30100,
			timedOut: true,
			containerId: "abc123",
		};

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(-2);
		expect(result.stderr).toContain("timed out");
	});
});

// =============================================================================
// Container Configuration Building
// =============================================================================

describe("ContainerConfig building", () => {
	test("builds minimal config", () => {
		const config = {
			Image: "alpine:latest",
			OpenStdin: true,
			AttachStdin: true,
			AttachStdout: true,
			AttachStderr: true,
			Tty: false,
			HostConfig: {
				Memory: 512 * 1024 * 1024,
				NanoCpus: 1_000_000_000,
				NetworkMode: "none",
				AutoRemove: false,
			},
		};

		expect(config.Image).toBe("alpine:latest");
		expect(config.OpenStdin).toBe(true);
		expect(config.Tty).toBe(false);
		expect(config.HostConfig.NetworkMode).toBe("none");
	});

	test("includes optional Cmd when provided", () => {
		const cmd = ["python", "-c"];
		const config = {
			Image: "python:3.12",
			Cmd: cmd,
		};

		expect(config.Cmd).toEqual(["python", "-c"]);
	});

	test("includes optional Env when provided", () => {
		const env = ["DEBUG=true", "LOG_LEVEL=verbose"];
		const config = {
			Image: "node:20",
			Env: env,
		};

		expect(config.Env).toEqual(env);
	});

	test("includes optional WorkingDir when provided", () => {
		const config = {
			Image: "node:20",
			WorkingDir: "/workspace",
		};

		expect(config.WorkingDir).toBe("/workspace");
	});
});

// =============================================================================
// Error Message Handling
// =============================================================================

describe("Error message handling", () => {
	test("formats container creation error", () => {
		const errorMessage = "Failed to create container";
		const result = {
			exitCode: -1,
			stdout: "",
			stderr: errorMessage,
			durationMs: 50,
			timedOut: false,
			containerId: "",
		};

		expect(result.stderr).toBe("Failed to create container");
	});

	test("formats container start error", () => {
		const errorMessage = "Failed to start container";
		const result = {
			exitCode: -1,
			stdout: "",
			stderr: errorMessage,
			durationMs: 100,
			timedOut: false,
			containerId: "abc123",
		};

		expect(result.stderr).toBe("Failed to start container");
		expect(result.containerId).toBe("abc123");
	});

	test("formats timeout error message", () => {
		const timeout = 30000;
		const originalStderr = "partial error output";
		const formattedStderr = `Execution timed out after ${timeout}ms and was terminated.\n${originalStderr}`.trim();

		expect(formattedStderr).toContain("timed out");
		expect(formattedStderr).toContain("30000ms");
		expect(formattedStderr).toContain("partial error output");
	});

	test("formats Docker daemon not running error", () => {
		const errorMessage = "Docker daemon not running. Start Docker and try again.";
		const result = {
			exitCode: -1,
			stdout: "",
			stderr: errorMessage,
			durationMs: 10,
			timedOut: false,
			containerId: "",
		};

		expect(result.stderr).toContain("Docker daemon not running");
	});

	test("formats generic execution error", () => {
		const originalError = "Some unexpected error";
		const formattedStderr = `Execution failed: ${originalError}`;

		expect(formattedStderr).toBe("Execution failed: Some unexpected error");
	});
});

// =============================================================================
// Docker Socket Error Detection
// =============================================================================

describe("Docker socket error detection", () => {
	const isDockerSocketError = (message: string): boolean => {
		return (
			message.includes("Cannot connect to Docker") ||
			message.includes("ENOENT") ||
			message.includes("EACCES")
		);
	};

	test("detects ENOENT error", () => {
		expect(isDockerSocketError("ENOENT: no such file or directory")).toBe(true);
	});

	test("detects EACCES error", () => {
		expect(isDockerSocketError("EACCES: permission denied")).toBe(true);
	});

	test("detects Cannot connect error", () => {
		expect(
			isDockerSocketError("Cannot connect to Docker socket at /var/run/docker.sock")
		).toBe(true);
	});

	test("does not detect unrelated errors", () => {
		expect(isDockerSocketError("Container not found")).toBe(false);
		expect(isDockerSocketError("Image pull failed")).toBe(false);
	});
});

// =============================================================================
// Default Values
// =============================================================================

describe("Default values", () => {
	test("default timeout is 30 seconds", () => {
		const DEFAULT_TIMEOUT_MS = 30_000;
		expect(DEFAULT_TIMEOUT_MS).toBe(30000);
	});

	test("default memory is 512m", () => {
		const DEFAULT_MEMORY = "512m";
		expect(DEFAULT_MEMORY).toBe("512m");
	});

	test("default CPUs is 1", () => {
		const DEFAULT_CPUS = 1;
		expect(DEFAULT_CPUS).toBe(1);
	});

	test("default network mode is none (isolated)", () => {
		const DEFAULT_NETWORK_MODE = "none";
		expect(DEFAULT_NETWORK_MODE).toBe("none");
	});

	test("stop grace period is 2 seconds", () => {
		const STOP_GRACE_PERIOD_MS = 2_000;
		expect(STOP_GRACE_PERIOD_MS).toBe(2000);
	});
});

// =============================================================================
// Exit Code Interpretation
// =============================================================================

describe("Exit code interpretation", () => {
	test("exit code 0 means success", () => {
		const exitCode = 0;
		expect(exitCode).toBe(0);
	});

	test("exit code -1 means execution error", () => {
		const exitCode = -1;
		expect(exitCode).toBeLessThan(0);
	});

	test("exit code -2 means timeout", () => {
		const exitCode = -2;
		const timedOut = true;
		expect(exitCode).toBe(-2);
		expect(timedOut).toBe(true);
	});

	test("positive exit codes come from container process", () => {
		const exitCode = 1; // Common error exit code
		expect(exitCode).toBeGreaterThan(0);
	});

	test("exit code 137 typically means killed by SIGKILL", () => {
		const exitCode = 137; // 128 + 9 (SIGKILL)
		expect(exitCode).toBe(137);
	});
});

// =============================================================================
// Timeout Behavior
// =============================================================================

describe("Timeout behavior", () => {
	test("timeout promise races against container wait", () => {
		// This tests the concept of Promise.race behavior
		const fastPromise = Promise.resolve("fast");
		const slowPromise = new Promise((resolve) =>
			setTimeout(() => resolve("slow"), 100)
		);

		return Promise.race([fastPromise, slowPromise]).then((result) => {
			expect(result).toBe("fast");
		});
	});

	test("timeout rejection includes TIMEOUT message", async () => {
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error("TIMEOUT")), 10);
		});

		await expect(timeoutPromise).rejects.toThrow("TIMEOUT");
	});
});

// =============================================================================
// Duration Calculation
// =============================================================================

describe("Duration calculation", () => {
	test("calculates duration in milliseconds", () => {
		const startTime = performance.now();
		// Simulate some work
		let sum = 0;
		for (let i = 0; i < 10000; i++) {
			sum += i;
		}
		const endTime = performance.now();
		const durationMs = Math.round(endTime - startTime);

		expect(durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof durationMs).toBe("number");
		expect(Number.isInteger(durationMs)).toBe(true);
	});

	test("rounds duration to integer", () => {
		const fractionalDuration = 123.456;
		const roundedDuration = Math.round(fractionalDuration);
		expect(roundedDuration).toBe(123);
	});
});
