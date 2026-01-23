/**
 * Utility functions for the docker tool.
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

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format bytes to human-readable string.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`
}

/**
 * Format Unix timestamp to human-readable string.
 */
export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp * 1000).toISOString()
}

/**
 * Truncate a string with ellipsis.
 */
export const truncate = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str
  return `${str.substring(0, maxLength - 3)}...`
}

/**
 * Format container names (strip leading slash).
 */
export const formatContainerName = (names: string[]): string => {
  return names.map((n) => (n.startsWith('/') ? n.slice(1) : n)).join(', ')
}
