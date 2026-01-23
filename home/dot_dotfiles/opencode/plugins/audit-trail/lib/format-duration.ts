/**
 * Format duration in milliseconds to a human-readable string
 */
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '-'
  return `${Math.round(ms)}ms`
}
