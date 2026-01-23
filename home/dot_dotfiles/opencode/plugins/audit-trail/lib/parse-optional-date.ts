/**
 * Parse an optional ISO date string into a Date object.
 * Returns undefined if the string is empty or invalid.
 */
export const parseOptionalDate = (dateStr?: string): Date | undefined => {
  if (!dateStr) {
    return undefined
  }

  const date = new Date(dateStr)

  if (Number.isNaN(date.getTime())) {
    return undefined
  }

  return date
}
