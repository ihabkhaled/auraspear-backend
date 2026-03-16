import { CaseStatus, CaseTaskStatus, CaseTimelineType, SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { CaseCommentResponse } from './cases.types'
import type { UpdateCaseDto } from './dto/update-case.dto'
import type { CaseSeverity, Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildCaseWhereClause(
  tenantId: string,
  filters: {
    status?: string
    severity?: string
    query?: string
    cycleId?: string
    ownerUserId?: string
  }
): Prisma.CaseWhereInput {
  const where: Prisma.CaseWhereInput = { tenantId }

  if (filters.status) {
    where.status = filters.status as CaseStatus
  }

  if (filters.severity) {
    where.severity = filters.severity as CaseSeverity
  }

  if (filters.cycleId === 'none') {
    where.cycleId = null
  } else if (filters.cycleId) {
    where.cycleId = filters.cycleId
  }

  if (filters.ownerUserId) {
    where.ownerUserId = filters.ownerUserId
  }

  if (filters.query && filters.query.trim().length > 0) {
    where.OR = [
      { title: { contains: filters.query, mode: 'insensitive' } },
      { caseNumber: { contains: filters.query, mode: 'insensitive' } },
      { description: { contains: filters.query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildCaseOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.CaseOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'severity':
      return { severity: order }
    case 'status':
      return { status: order }
    case 'caseNumber':
      return { caseNumber: order }
    case 'title':
      return { title: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildCaseUpdateData(
  dto: UpdateCaseDto,
  isReopening: boolean
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {}
  if (dto.title !== undefined) updateData['title'] = dto.title
  if (dto.description !== undefined) updateData['description'] = dto.description
  if (dto.severity !== undefined) updateData['severity'] = dto.severity
  if (dto.status !== undefined) updateData['status'] = dto.status
  if (dto.ownerUserId !== undefined) updateData['ownerUserId'] = dto.ownerUserId
  if (dto.cycleId !== undefined) updateData['cycleId'] = dto.cycleId
  if (dto.status === CaseStatus.CLOSED) updateData['closedAt'] = new Date()
  if (isReopening) updateData['closedAt'] = null
  return updateData
}

/* ---------------------------------------------------------------- */
/* TIMELINE DESCRIPTION BUILDING                                     */
/* ---------------------------------------------------------------- */

export function buildFieldChangeDescription(
  dto: UpdateCaseDto,
  existing: { title: string; description: string | null; severity: string },
  actorLabel: string
): string {
  const changes: string[] = []
  if (dto.title !== undefined && dto.title !== existing.title) {
    changes.push(`title changed to "${dto.title}"`)
  }
  if (dto.description !== undefined && dto.description !== existing.description) {
    changes.push('description updated')
  }
  if (dto.severity !== undefined && dto.severity !== existing.severity) {
    changes.push(`severity changed from ${existing.severity} to ${dto.severity}`)
  }
  return changes.length > 0
    ? `Case updated by ${actorLabel}: ${changes.join(', ')}`
    : `Case updated by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* STATS CALCULATION                                                 */
/* ---------------------------------------------------------------- */

export function calculateAvgResolutionHours(
  closedCases: Array<{ closedAt: Date | null; createdAt: Date }>
): number | null {
  if (closedCases.length === 0) return null

  let totalHours = 0
  let count = 0
  for (const c of closedCases) {
    if (c.closedAt) {
      totalHours += (c.closedAt.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60)
      count++
    }
  }

  if (count === 0) return null
  return Math.round((totalHours / count) * 10) / 10
}

/* ---------------------------------------------------------------- */
/* COMMENT → RESPONSE MAPPING                                        */
/* ---------------------------------------------------------------- */

export function mapCommentToResponseShape(
  comment: {
    id: string
    caseId: string
    authorId: string
    body: string
    isEdited: boolean
    isDeleted: boolean
    createdAt: Date
    updatedAt: Date
    mentions: Array<{ userId: string }>
  },
  userMap: Map<string, { id: string; name: string; email: string }>
): CaseCommentResponse {
  const author = userMap.get(comment.authorId)

  return {
    id: comment.id,
    caseId: comment.caseId,
    body: comment.body,
    isEdited: comment.isEdited,
    isDeleted: comment.isDeleted,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      id: comment.authorId,
      name: author?.name ?? 'Unknown',
      email: author?.email ?? '',
    },
    mentions: comment.mentions.map(m => {
      const mentionUser = userMap.get(m.userId)
      return {
        id: m.userId,
        name: mentionUser?.name ?? 'Unknown',
        email: mentionUser?.email ?? '',
      }
    }),
  }
}

/* ---------------------------------------------------------------- */
/* CASE LIST ITEM MAPPING                                            */
/* ---------------------------------------------------------------- */

export function mapCaseListItem(
  caseItem: {
    ownerUserId: string | null
    createdBy: string | null
    tenant: { name: string }
  } & Record<string, unknown>,
  ownersMap: Map<string, { name: string; email: string }>,
  creatorsMap: Map<string, string>
): Record<string, unknown> {
  const owner = caseItem.ownerUserId ? ownersMap.get(caseItem.ownerUserId) : undefined
  return {
    ...caseItem,
    ownerName: owner?.name ?? null,
    ownerEmail: owner?.email ?? null,
    createdByName: caseItem.createdBy ? (creatorsMap.get(caseItem.createdBy) ?? null) : null,
    tenantName: caseItem.tenant.name,
  }
}

/* ---------------------------------------------------------------- */
/* REOPEN / CLOSED GUARD HELPERS                                     */
/* ---------------------------------------------------------------- */

export function isReopeningCase(existingStatus: string, newStatus: string | undefined): boolean {
  return (
    existingStatus === CaseStatus.CLOSED &&
    newStatus !== undefined &&
    newStatus !== CaseStatus.CLOSED
  )
}

export function shouldBlockClosedCaseUpdate(
  existingStatus: string,
  isReopening: boolean,
  isAssigneeChange: boolean
): boolean {
  return existingStatus === CaseStatus.CLOSED && !isReopening && !isAssigneeChange
}

/* ---------------------------------------------------------------- */
/* TIMELINE TYPE RESOLUTION                                          */
/* ---------------------------------------------------------------- */

export function resolveTimelineType(isStatusChange: boolean): string {
  return isStatusChange ? CaseTimelineType.STATUS_CHANGED : CaseTimelineType.UPDATED
}

/* ---------------------------------------------------------------- */
/* ASSIGNEE TIMELINE DESCRIPTION                                     */
/* ---------------------------------------------------------------- */

export function buildAssigneeTimelineDescription(
  dto: { ownerUserId?: string | null },
  previousOwnerLabel: string | null,
  newOwnerLabel: string | null,
  actorLabel: string
): string {
  if (dto.ownerUserId === null) {
    return previousOwnerLabel
      ? `Assignee removed (was ${previousOwnerLabel}) by ${actorLabel}`
      : `Assignee removed by ${actorLabel}`
  }

  const ownerLabel = newOwnerLabel ?? dto.ownerUserId ?? 'unknown'
  return previousOwnerLabel
    ? `Assigned to ${ownerLabel} from ${previousOwnerLabel} by ${actorLabel}`
    : `Assigned to ${ownerLabel} by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* CYCLE TIMELINE DESCRIPTION                                        */
/* ---------------------------------------------------------------- */

export function buildCycleTimelineDescription(
  cycleId: string | null | undefined,
  cycleName: string | null,
  actorLabel: string
): string {
  if (cycleId === null) {
    return `Removed from cycle by ${actorLabel}`
  }
  return `Added to cycle "${cycleName ?? cycleId}" by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* STATUS TIMELINE DESCRIPTION                                       */
/* ---------------------------------------------------------------- */

export function buildStatusTimelineDescription(
  isReopening: boolean,
  newStatus: string | undefined,
  actorLabel: string
): string {
  if (isReopening) return `Case re-opened by ${actorLabel}`
  return `Status changed to ${newStatus} by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* TASK UPDATE DATA                                                  */
/* ---------------------------------------------------------------- */

export function buildTaskUpdateData(dto: {
  title?: string
  status?: string
  assignee?: string | null
}): Record<string, unknown> {
  const updateData: Record<string, unknown> = {}
  if (dto.title !== undefined) updateData['title'] = dto.title
  if (dto.status !== undefined) updateData['status'] = dto.status
  if (dto.assignee !== undefined) updateData['assignee'] = dto.assignee
  return updateData
}

/* ---------------------------------------------------------------- */
/* TASK TIMELINE DESCRIPTION                                         */
/* ---------------------------------------------------------------- */

export function buildTaskStatusTimelineDescription(
  taskTitle: string,
  newStatus: string,
  actorLabel: string
): string {
  const statusText =
    newStatus === CaseTaskStatus.COMPLETED ? 'completed' : `changed to ${newStatus}`
  return `Task "${taskTitle}" ${statusText} by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* TEXT HELPERS                                                       */
/* ---------------------------------------------------------------- */

export function truncateBody(body: string, maxLength = 80): string {
  return body.length > maxLength ? `${body.slice(0, maxLength)}...` : body
}

export function formatActorLabel(userName: string | null, email: string): string {
  return userName ? `${userName} (${email})` : email
}

export function formatUserLabel(
  user: { name: string; email: string } | null,
  fallbackId: string
): string {
  return user ? `${user.name} (${user.email})` : fallbackId
}

/* ---------------------------------------------------------------- */
/* NOTIFICATION HELPERS                                              */
/* ---------------------------------------------------------------- */

export function hasFieldChangesOnly(dto: UpdateCaseDto, isStatusChange: boolean): boolean {
  return (
    !isStatusChange &&
    dto.ownerUserId === undefined &&
    dto.cycleId === undefined &&
    (dto.title !== undefined || dto.description !== undefined || dto.severity !== undefined)
  )
}

export function buildCycleNotificationMessage(
  caseNumber: string,
  cycleId: string | null | undefined
): string {
  return cycleId === null
    ? `Case ${caseNumber} removed from cycle`
    : `Case ${caseNumber} added to a cycle`
}
