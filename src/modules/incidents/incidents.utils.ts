import { IncidentStatus } from '../../common/enums'
import type { UpdateIncidentDto } from './dto/update-incident.dto'
import type { Incident, Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildIncidentWhereClause(
  tenantId: string,
  filters: {
    status?: string
    severity?: string
    category?: string
    query?: string
  }
): Prisma.IncidentWhereInput {
  const where: Prisma.IncidentWhereInput = { tenantId }

  if (filters.status) {
    where.status = filters.status as Prisma.IncidentWhereInput['status']
  }

  if (filters.severity) {
    where.severity = filters.severity as Prisma.IncidentWhereInput['severity']
  }

  if (filters.category) {
    where.category = filters.category as Prisma.IncidentWhereInput['category']
  }

  if (filters.query && filters.query.trim().length > 0) {
    where.OR = [
      { title: { contains: filters.query, mode: 'insensitive' } },
      { incidentNumber: { contains: filters.query, mode: 'insensitive' } },
      { description: { contains: filters.query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildIncidentOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.IncidentOrderByWithRelationInput {
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'severity':
      return { severity: order }
    case 'status':
      return { status: order }
    case 'incidentNumber':
      return { incidentNumber: order }
    default:
      return { createdAt: 'desc' }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildIncidentUpdateData(
  dto: UpdateIncidentDto,
  existingStatus: string,
  existingResolvedAt: Date | null
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {}

  if (dto.title !== undefined) updateData['title'] = dto.title
  if (dto.description !== undefined) updateData['description'] = dto.description
  if (dto.severity !== undefined) updateData['severity'] = dto.severity
  if (dto.status !== undefined) updateData['status'] = dto.status
  if (dto.category !== undefined) updateData['category'] = dto.category
  if (dto.assigneeId !== undefined) updateData['assigneeId'] = dto.assigneeId
  if (dto.linkedAlertIds !== undefined) updateData['linkedAlertIds'] = dto.linkedAlertIds
  if (dto.linkedCaseId !== undefined) updateData['linkedCaseId'] = dto.linkedCaseId
  if (dto.mitreTactics !== undefined) updateData['mitreTactics'] = dto.mitreTactics
  if (dto.mitreTechniques !== undefined) updateData['mitreTechniques'] = dto.mitreTechniques

  // Handle resolvedAt for status transitions
  if (
    (dto.status === IncidentStatus.RESOLVED || dto.status === IncidentStatus.CLOSED) &&
    !existingResolvedAt
  ) {
    updateData['resolvedAt'] = new Date()
  }
  // Clear resolvedAt if re-opening
  if (
    dto.status === IncidentStatus.OPEN ||
    dto.status === IncidentStatus.IN_PROGRESS ||
    dto.status === IncidentStatus.CONTAINED
  ) {
    updateData['resolvedAt'] = null
  }

  return updateData
}

/* ---------------------------------------------------------------- */
/* TIMELINE DESCRIPTION BUILDING                                     */
/* ---------------------------------------------------------------- */

export function describeIncidentChanges(
  dto: UpdateIncidentDto,
  existing: {
    title: string
    description: string | null
    severity: string
    category: string
    status: string
  },
  actorLabel: string
): string {
  const isStatusChange = dto.status !== undefined && dto.status !== existing.status
  if (isStatusChange) {
    return `Status changed from ${existing.status} to ${dto.status} by ${actorLabel}`
  }

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
  if (dto.category !== undefined && dto.category !== existing.category) {
    changes.push(`category changed from ${existing.category} to ${dto.category}`)
  }
  if (dto.assigneeId !== undefined) {
    changes.push('assignee updated')
  }

  return changes.length > 0
    ? `Incident updated by ${actorLabel}: ${changes.join(', ')}`
    : `Incident updated by ${actorLabel}`
}

/* ---------------------------------------------------------------- */
/* STATS CALCULATION                                                 */
/* ---------------------------------------------------------------- */

export function calculateAvgResolveHours(
  resolvedIncidents: Array<{ resolvedAt: Date | null; createdAt: Date }>
): number | null {
  if (resolvedIncidents.length === 0) return null

  const totalHours = resolvedIncidents.reduce((sum, index) => {
    if (!index.resolvedAt) return sum
    const diffMs = index.resolvedAt.getTime() - index.createdAt.getTime()
    return sum + diffMs / (1000 * 60 * 60)
  }, 0)

  return Math.round((totalHours / resolvedIncidents.length) * 100) / 100
}

/* ---------------------------------------------------------------- */
/* ASSIGNEE BATCH RESOLUTION                                         */
/* ---------------------------------------------------------------- */

export function buildAssigneesMap(
  assignees: Array<{ id: string; name: string; email: string }>
): Map<string, { name: string; email: string }> {
  const map = new Map<string, { name: string; email: string }>()
  for (const a of assignees) {
    map.set(a.id, { name: a.name, email: a.email })
  }
  return map
}

export function buildCreatorsMap(
  users: Array<{ email: string; name: string }>
): Map<string, string> {
  const map = new Map<string, string>()
  for (const u of users) {
    map.set(u.email, u.name)
  }
  return map
}

export function mapIncidentListItem(
  incident: Incident & { tenant: { name: string } },
  assigneesMap: Map<string, { name: string; email: string }>,
  creatorsMap: Map<string, string>
): Incident & {
  assigneeName: string | null
  assigneeEmail: string | null
  createdByName: string | null
  tenantName: string
} {
  const assignee = incident.assigneeId ? assigneesMap.get(incident.assigneeId) : undefined
  return {
    ...incident,
    assigneeName: assignee?.name ?? null,
    assigneeEmail: assignee?.email ?? null,
    createdByName: incident.createdBy ? (creatorsMap.get(incident.createdBy) ?? null) : null,
    tenantName: incident.tenant.name,
  }
}
