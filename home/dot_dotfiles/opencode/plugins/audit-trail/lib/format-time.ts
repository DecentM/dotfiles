/**
 * Format just the time portion of a Date
 */
export const formatTime = (date: Date): string => {
  const pad = (n: number): string => n.toString().padStart(2, '0')

  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return `${hours}:${minutes}:${seconds}`
}
