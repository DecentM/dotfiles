/**
 * Utility functions for the sh tool.
 */

// =============================================================================
// Time Parsing
// =============================================================================

/**
 * Parse a time filter string into a Date object.
 * Supports formats like '1h', '24h', '7d', 'week', 'month', or ISO dates.
 */
export const parseSince = (since: string): Date => {
  const now = new Date()

  const match = since.match(/^(\d+)(h|d|w|m)$/)
  if (match) {
    const [, num, unit] = match
    const n = parseInt(num, 10)
    switch (unit) {
      case 'h':
        return new Date(now.getTime() - n * 60 * 60 * 1000)
      case 'd':
        return new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
      case 'w':
        return new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000)
      case 'm':
        return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000)
    }
  }

  // Named periods
  switch (since.toLowerCase()) {
    case 'hour':
      return new Date(now.getTime() - 60 * 60 * 1000)
    case 'day':
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case 'week':
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case 'month':
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    default: {
      // Try parsing as ISO date
      const parsed = new Date(since)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
      // Default to 24h
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    }
  }
}
