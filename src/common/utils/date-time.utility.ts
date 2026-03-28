/**
 * Shared date/time utility functions for common date arithmetic patterns.
 */

/**
 * Returns a Date object representing `days` days before the current time.
 */
export function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

/**
 * Returns a Date object representing `days` days after the given date (or now).
 */
export function addDays(days: number, from?: Date): Date {
  const date = from ? new Date(from.getTime()) : new Date()
  date.setDate(date.getDate() + days)
  return date
}

/**
 * Returns a Date object representing `days` days before the given date (or now).
 */
export function subtractDays(days: number, from?: Date): Date {
  return addDays(-days, from)
}
