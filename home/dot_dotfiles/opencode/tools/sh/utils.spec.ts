/**
 * Tests for the utils module.
 * Tests time parsing and other utility functions.
 */

import { describe, test, expect } from "bun:test";
import { parseSince } from "./utils";

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
      // Allow 1 second tolerance for test execution time
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });

    test("parses 24h", () => {
      const result = parseSince("24h");
      const expected = now - 24 * HOUR;
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

    test("parses '30d' same as month", () => {
      const result = parseSince("30d");
      const expected = now - 30 * DAY;
      expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
    });
  });

  describe("ISO date strings", () => {
    test("parses ISO date string", () => {
      const isoDate = "2024-01-15T10:30:00Z";
      const result = parseSince(isoDate);
      // toISOString() includes milliseconds, so compare the Date objects
      expect(result.getTime()).toBe(new Date(isoDate).getTime());
    });

    test("parses date-only string", () => {
      const dateStr = "2024-06-15";
      const result = parseSince(dateStr);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // June is month 5 (0-indexed)
      expect(result.getDate()).toBe(15);
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
  });
});
