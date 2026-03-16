import { SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* ENTITY QUERY BUILDING                                             */
/* ---------------------------------------------------------------- */

export function buildEntityListWhere(
  tenantId: string,
  entityType?: string,
  riskLevel?: string,
  query?: string
): Prisma.UebaEntityWhereInput {
  const where: Prisma.UebaEntityWhereInput = { tenantId }

  if (entityType) {
    where.entityType = entityType as Prisma.UebaEntityWhereInput['entityType']
  }

  if (riskLevel) {
    where.riskLevel = riskLevel as Prisma.UebaEntityWhereInput['riskLevel']
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { entityName: { contains: query, mode: 'insensitive' } },
      { topAnomaly: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildEntityOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.UebaEntityOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'riskScore':
      return { riskScore: order }
    case 'entityName':
      return { entityName: order }
    case 'lastSeenAt':
      return { lastSeenAt: order }
    case 'riskLevel':
      return { riskLevel: order }
    case 'entityType':
      return { entityType: order }
    default:
      return { riskScore: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* ANOMALY QUERY BUILDING                                            */
/* ---------------------------------------------------------------- */

export function buildAnomalyListWhere(
  tenantId: string,
  severity?: string,
  entityId?: string,
  resolved?: boolean
): Prisma.UebaAnomalyWhereInput {
  const where: Prisma.UebaAnomalyWhereInput = { tenantId }

  if (severity) {
    where.severity = severity as Prisma.UebaAnomalyWhereInput['severity']
  }

  if (entityId) {
    where.entityId = entityId
  }

  if (resolved !== undefined) {
    where.resolved = resolved
  }

  return where
}

export function buildAnomalyOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.UebaAnomalyOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'detectedAt':
      return { detectedAt: order }
    case 'score':
      return { score: order }
    case 'severity':
      return { severity: order }
    default:
      return { detectedAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* ML MODEL QUERY BUILDING                                           */
/* ---------------------------------------------------------------- */

export function buildModelListWhere(
  tenantId: string,
  status?: string,
  modelType?: string
): Prisma.MlModelWhereInput {
  const where: Prisma.MlModelWhereInput = { tenantId }

  if (status) {
    where.status = status as Prisma.MlModelWhereInput['status']
  }

  if (modelType) {
    where.modelType = modelType as Prisma.MlModelWhereInput['modelType']
  }

  return where
}

export function buildModelOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.MlModelOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'accuracy':
      return { accuracy: order }
    case 'name':
      return { name: order }
    case 'lastTrained':
      return { lastTrained: order }
    default:
      return { updatedAt: SortOrder.DESC }
  }
}
