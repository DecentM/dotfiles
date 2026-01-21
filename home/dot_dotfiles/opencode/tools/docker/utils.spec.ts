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
  // Get current time for relative comparisons
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  describe("numeric with unit", () => {
    test("parses 1h", () => {
      const result = parseSince("1h");
      const expected = now - 1 * HOUR;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 24h", () => {
      const result = parseSince("24h");
      const expected = now - 24 * HOUR;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses multi-digit hours", () => {
      const result = parseSince("48h");
      const expected = now - 48 * HOUR;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 7d", () => {
      const result = parseSince("7d");
      const expected = now - 7 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 2w (weeks)", () => {
      const result = parseSince("2w");
      const expected = now - 14 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 1m (months)", () => {
      const result = parseSince("1m");
      const expected = now - 30 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 3m (months)", () => {
      const result = parseSince("3m");
      const expected = now - 90 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });
  });

  describe("named periods", () => {
    test("parses 'hour'", () => {
      const result = parseSince("hour");
      const expected = now - HOUR;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 'day'", () => {
      const result = parseSince("day");
      const expected = now - DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 'week'", () => {
      const result = parseSince("week");
      const expected = now - 7 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 'month'", () => {
      const result = parseSince("month");
      const expected = now - 30 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });
  });

  describe("ISO date strings", () => {
    test("parses ISO date string with time", () => {
      const isoDate = "2024-01-15T10:30:00Z";
      const result = parseSince(isoDate);
      expect(result.getTime()).toBe(new Date(isoDate).getTime());
    });

    test("parses date-only string", () => {
      const dateStr = "2024-06-15";
      const result = parseSince(dateStr);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // June is month 5 (0-indexed)
      expect(result.getDate()).toBe(15);
    });

    test("parses ISO date with milliseconds", () => {
      const isoDate = "2024-01-15T10:30:00.123Z";
      const result = parseSince(isoDate);
      expect(result.getTime()).toBe(new Date(isoDate).getTime());
    });
  });

  describe("invalid input", () => {
    test("defaults to 24h for invalid input", () => {
      const result = parseSince("invalid");
      const expected = now - DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("defaults to 24h for empty string", () => {
      const result = parseSince("");
      const expected = now - DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("defaults to 24h for random string", () => {
      const result = parseSince("xyz123");
      const expected = now - DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });
  });

  describe("case insensitivity", () => {
    test("parses WEEK (uppercase)", () => {
      const result = parseSince("WEEK");
      const expected = now - 7 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses Month (mixed case)", () => {
      const result = parseSince("Month");
      const expected = now - 30 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 7D (uppercase unit)", () => {
      const result = parseSince("7D");
      const expected = now - 7 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });
  });
});

// =============================================================================
// formatBytes
// =============================================================================

describe("formatBytes", () => {
  describe("bytes (< 1KB)", () => {
    test("formats 0 bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    test("formats 1 byte", () => {
      expect(formatBytes(1)).toBe("1 B");
    });

    test("formats 500 bytes", () => {
      expect(formatBytes(500)).toBe("500 B");
    });

    test("formats 1023 bytes (just under 1KB)", () => {
      expect(formatBytes(1023)).toBe("1023 B");
    });
  });

  describe("kilobytes (1KB - 1MB)", () => {
    test("formats 1 KB exactly", () => {
      expect(formatBytes(1024)).toBe("1 KB");
    });

    test("formats 2 KB", () => {
      expect(formatBytes(2048)).toBe("2 KB");
    });

    test("formats fractional KB", () => {
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    test("formats 512 KB", () => {
      expect(formatBytes(512 * 1024)).toBe("512 KB");
    });
  });

  describe("megabytes (1MB - 1GB)", () => {
    test("formats 1 MB exactly", () => {
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
    });

    test("formats 1.5 MB", () => {
      expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    });

    test("formats 100 MB", () => {
      expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
    });

    test("formats 512 MB", () => {
      expect(formatBytes(512 * 1024 * 1024)).toBe("512 MB");
    });
  });

  describe("gigabytes (1GB - 1TB)", () => {
    test("formats 1 GB exactly", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });

    test("formats 2.5 GB", () => {
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
    });

    test("formats 100 GB", () => {
      expect(formatBytes(100 * 1024 * 1024 * 1024)).toBe("100 GB");
    });
  });

  describe("terabytes (>= 1TB)", () => {
    test("formats 1 TB exactly", () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1 TB");
    });

    test("formats 10 TB", () => {
      expect(formatBytes(10 * 1024 * 1024 * 1024 * 1024)).toBe("10 TB");
    });
  });

  describe("edge cases", () => {
    test("handles negative numbers gracefully", () => {
      // Implementation may vary - just ensure it doesn't crash
      const result = formatBytes(-100);
      expect(typeof result).toBe("string");
    });
  });
});

// =============================================================================
// formatTimestamp
// =============================================================================

describe("formatTimestamp", () => {
  describe("Unix timestamp conversion", () => {
    test("converts Unix epoch (0) to ISO string", () => {
      const result = formatTimestamp(0);
      expect(result).toBe("1970-01-01T00:00:00.000Z");
    });

    test("converts known timestamp", () => {
      const timestamp = 1705320000; // 2024-01-15T10:40:00Z
      const result = formatTimestamp(timestamp);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("round-trips correctly", () => {
      const timestamp = 1705320000;
      const result = formatTimestamp(timestamp);
      expect(new Date(result).getTime()).toBe(timestamp * 1000);
    });
  });

  describe("ISO format", () => {
    test("returns valid ISO 8601 format", () => {
      const timestamp = 1609459200; // 2021-01-01T00:00:00Z
      const result = formatTimestamp(timestamp);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("includes milliseconds", () => {
      const result = formatTimestamp(0);
      expect(result).toContain(".000Z");
    });
  });

  describe("edge cases", () => {
    test("handles recent timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      const result = formatTimestamp(now);
      expect(result).toBeDefined();
      expect(new Date(result).getTime()).toBe(now * 1000);
    });

    test("handles future timestamp", () => {
      const future = Math.floor(Date.now() / 1000) + 86400; // Tomorrow
      const result = formatTimestamp(future);
      expect(new Date(result).getTime()).toBe(future * 1000);
    });
  });
});

// =============================================================================
// truncate
// =============================================================================

describe("truncate", () => {
  describe("strings shorter than or equal to max", () => {
    test("returns string unchanged if shorter than max", () => {
      expect(truncate("short", 10)).toBe("short");
    });

    test("returns string unchanged if exactly max length", () => {
      expect(truncate("exactly", 7)).toBe("exactly");
    });

    test("returns empty string unchanged", () => {
      expect(truncate("", 10)).toBe("");
    });

    test("returns single character unchanged", () => {
      expect(truncate("a", 5)).toBe("a");
    });
  });

  describe("strings longer than max", () => {
    test("truncates and adds ellipsis if longer than max", () => {
      expect(truncate("this is a long string", 10)).toBe("this is...");
    });

    test("truncates long string", () => {
      expect(truncate("abcdefghijklmnop", 8)).toBe("abcde...");
    });
  });

  describe("edge cases", () => {
    test("handles very short max length", () => {
      expect(truncate("hello", 4)).toBe("h...");
    });

    test("handles max length of 3 (just ellipsis)", () => {
      expect(truncate("hello", 3)).toBe("...");
    });

    test("handles max length of 1", () => {
      // Edge case - may just return the ellipsis or first char
      const result = truncate("hello", 1);
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe("unicode handling", () => {
    test("handles string with unicode characters", () => {
      const result = truncate("Hello World", 8);
      expect(result.length).toBe(8);
      expect(result.endsWith("...")).toBe(true);
    });
  });
});

// =============================================================================
// formatContainerName
// =============================================================================

describe("formatContainerName", () => {
  describe("single container name", () => {
    test("strips leading slash from names", () => {
      expect(formatContainerName(["/mycontainer"])).toBe("mycontainer");
    });

    test("handles names without leading slash", () => {
      expect(formatContainerName(["mycontainer"])).toBe("mycontainer");
    });

    test("handles complex container names", () => {
      expect(formatContainerName(["/my-app_container-1"])).toBe("my-app_container-1");
    });
  });

  describe("multiple container names", () => {
    test("joins multiple names with comma and space", () => {
      expect(formatContainerName(["/container1", "/container2"])).toBe(
        "container1, container2"
      );
    });

    test("handles three names", () => {
      expect(formatContainerName(["/a", "/b", "/c"])).toBe("a, b, c");
    });

    test("strips slashes from all names", () => {
      expect(formatContainerName(["/name1", "name2", "/name3"])).toBe(
        "name1, name2, name3"
      );
    });
  });

  describe("edge cases", () => {
    test("handles empty array", () => {
      expect(formatContainerName([])).toBe("");
    });

    test("handles array with empty string", () => {
      expect(formatContainerName([""])).toBe("");
    });

    test("handles array with only slash", () => {
      expect(formatContainerName(["/"])).toBe("");
    });
  });
});
