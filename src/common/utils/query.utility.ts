/**
 * Shared query-building utilities for Prisma-based list endpoints.
 *
 * Eliminates repeated inline sort-order coercion and optional-filter
 * spreading that appears across 15+ module utility / service files.
 */

import { SortOrder } from '../enums'
import type { SortDirection } from './query.types'

export type { SortDirection } from './query.types'

/**
 * Coerce an arbitrary string into a Prisma-compatible sort direction.
 * Returns `SortOrder.ASC` only when the input is literally `'asc'`; every
 * other value (including `undefined`) falls back to `SortOrder.DESC`.
 */
export function toSortOrder(sortOrder?: string): SortDirection {
  return sortOrder === SortOrder.ASC ? SortOrder.ASC : SortOrder.DESC
}

/**
 * Append a set of optional scalar filters to an existing `where` object.
 *
 * Each entry in `filters` is only applied when its value is **truthy**.
 * This replaces the repetitive `if (x) { where.x = x }` blocks that
 * appear in nearly every `build*ListWhere` helper.
 *
 * @example
 * ```ts
 * const where: Prisma.IncidentWhereInput = { tenantId }
 * applyOptionalFilters(where, {
 *   status: filters.status,
 *   severity: filters.severity,
 *   category: filters.category,
 * })
 * ```
 */
export function applyOptionalFilters<W extends Record<string, unknown>>(
  where: W,
  filters: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      Reflect.set(where, key, value)
    }
  }
}
