/**
 * Tests for the docker utils module.
 * Tests utility functions.
 */

import { describe, test, expect } from "bun:test";
import {
  parseSince,
  formatBytes,
  formatTimestamp,
  truncate,
  formatContainerName,
} from "./utils";

// =============================================================================
// parseSince
// =============================================================================

describe("parseSince", () => {
  describe("relative time formats", () => {
    test("parses hours", () => {
      const now = Date.now();
      const result = parseSince("1h");
      const expectedMs = 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses days", () => {
      const now = Date.now();
      const result = parseSince("7d");
      const expectedMs = 7 * 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses weeks", () => {
      const now = Date.now();
      const result = parseSince("2w");
      const expectedMs = 2 * 7 * 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses months", () => {
      const now = Date.now();
      const result = parseSince("1m");
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });
  });

  describe("named periods", () => {
    test("parses 'hour'", () => {
      const now = Date.now();
      const result = parseSince("hour");
      const expectedMs = 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses 'day'", () => {
      const now = Date.now();
      const result = parseSince("day");
      const expectedMs = 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses 'week'", () => {
      const now = Date.now();
      const result = parseSince("week");
      const expectedMs = 7 * 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses 'month'", () => {
      const now = Date.now();
      const result = parseSince("month");
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });

    test("parses '24h'", () => {
      const now = Date.now();
      const result = parseSince("24h");
      const expectedMs = 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });
  });

  describe("ISO dates", () => {
    test("parses ISO date string", () => {
      const result = parseSince("2024-01-15T10:00:00Z");
      expect(result.toISOString()).toBe("2024-01-15T10:00:00.000Z");
    });
  });

  describe("fallback", () => {
    test("defaults to 24h for invalid input", () => {
      const now = Date.now();
      const result = parseSince("invalid");
      const expectedMs = 24 * 60 * 60 * 1000;
      expect(now - result.getTime()).toBeGreaterThan(expectedMs - 1000);
      expect(now - result.getTime()).toBeLessThan(expectedMs + 1000);
    });
  });
});

// =============================================================================
// formatBytes
// =============================================================================

describe("formatBytes", () => {
  test("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  test("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
  });

  test("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  test("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  test("formats terabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1 TB");
  });
});

// =============================================================================
// formatTimestamp
// =============================================================================

describe("formatTimestamp", () => {
  test("converts Unix timestamp to ISO string", () => {
    const timestamp = 0;
    const result = formatTimestamp(timestamp);
    // Should return an ISO string format
    expect(result).toBe("1970-01-01T00:00:00.000Z");
  });

  test("returns valid ISO format for any timestamp", () => {
    const timestamp = 1705320000;
    const result = formatTimestamp(timestamp);
    // Just verify it's a valid ISO date string
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // And that it parses back to the correct timestamp
    expect(new Date(result).getTime()).toBe(timestamp * 1000);
  });
});

// =============================================================================
// truncate
// =============================================================================

describe("truncate", () => {
  test("returns string unchanged if shorter than max", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  test("returns string unchanged if exactly max length", () => {
    expect(truncate("exactly", 7)).toBe("exactly");
  });

  test("truncates and adds ellipsis if longer than max", () => {
    expect(truncate("this is a long string", 10)).toBe("this is...");
  });

  test("handles very short max length", () => {
    expect(truncate("hello", 4)).toBe("h...");
  });
});

// =============================================================================
// formatContainerName
// =============================================================================

describe("formatContainerName", () => {
  test("strips leading slash from names", () => {
    expect(formatContainerName(["/mycontainer"])).toBe("mycontainer");
  });

  test("handles names without leading slash", () => {
    expect(formatContainerName(["mycontainer"])).toBe("mycontainer");
  });

  test("joins multiple names with comma", () => {
    expect(formatContainerName(["/container1", "/container2"])).toBe(
      "container1, container2"
    );
  });

  test("handles empty array", () => {
    expect(formatContainerName([])).toBe("");
  });
});
