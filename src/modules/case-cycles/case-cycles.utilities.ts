import { CaseCycleStatus, CaseStatus, SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { CaseCycleRecord } from './case-cycles.types'
import type { CaseCycleStatus as PrismaCycleStatus, Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildCycleWhereClause(
  tenantId: string,
  status?: string
): Prisma.CaseCycleWhereInput {
  const where: Prisma.CaseCycleWhereInput = { tenantId }
  if (status) {
    where.status = status as PrismaCycleStatus
  }
  return where
}

export function buildCycleOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.CaseCycleOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'name':
      return { name: order }
    case 'startDate':
      return { startDate: order }
    case 'endDate':
      return { endDate: order }
    case 'status':
      return { status: order }
    case 'createdAt':
      return { createdAt: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* CASE COUNTING                                                     */
/* ---------------------------------------------------------------- */

export function countOpenAndClosed(cases: Array<{ status: string }>): {
  openCount: number
  closedCount: number
} {
  let openCount = 0
  let closedCount = 0
  for (const c of cases) {
    if (c.status === CaseStatus.CLOSED) {
      closedCount++
    } else {
      openCount++
    }
  }
  return { openCount, closedCount }
}

/* ---------------------------------------------------------------- */
/* CYCLE → RECORD MAPPING                                            */
/* ---------------------------------------------------------------- */

export function mapCycleToRecord(
  cycle: {
    cases: Array<{ status: string }>
    _count: { cases: number }
  } & Record<string, unknown>
): CaseCycleRecord {
  const { openCount, closedCount } = countOpenAndClosed(cycle.cases)
  const { cases: _cases, _count, ...rest } = cycle
  return {
    ...rest,
    caseCount: _count.cases,
    openCount,
    closedCount,
  } as CaseCycleRecord
}

/* ---------------------------------------------------------------- */
/* DATE OVERLAP DETECTION                                            */
/* ---------------------------------------------------------------- */

export function datesOverlap(
  start1: Date,
  end1: Date | null,
  start2: Date,
  end2: Date | null
): boolean {
  if (end2 && start1 >= end2) return false
  if (end1 && start2 >= end1) return false
  return true
}

/* ---------------------------------------------------------------- */
/* DATE RANGE VALIDATION                                             */
/* ---------------------------------------------------------------- */

export function isTodayInRange(startDate: Date, endDate: Date | null): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return startDate <= today && (endDate === null || endDate >= today)
}

export function isFutureStart(startDate: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return startDate > today
}

export function isPastEnd(endDate: Date | null): boolean {
  if (!endDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return endDate < today
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildCycleUpdateData(dto: {
  name?: string
  description?: string | null
  startDate?: Date
  endDate?: Date | null
}): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (dto.name !== undefined) data['name'] = dto.name
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.startDate !== undefined) data['startDate'] = dto.startDate
  if (dto.endDate !== undefined) data['endDate'] = dto.endDate
  return data
}

export function applyAutoDeactivation(
  updateData: Record<string, unknown>,
  existingStatus: string,
  startDate: Date,
  endDate: Date | null,
  datesChanged: boolean,
  closerEmail: string
): void {
  if (existingStatus !== CaseCycleStatus.ACTIVE || !datesChanged) return
  if (isTodayInRange(startDate, endDate)) return

  updateData['status'] = CaseCycleStatus.CLOSED
  updateData['closedAt'] = new Date()
  updateData['closedBy'] = closerEmail
}
