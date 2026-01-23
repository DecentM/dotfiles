/**
 * Format a number with thousand separators
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US')
}
