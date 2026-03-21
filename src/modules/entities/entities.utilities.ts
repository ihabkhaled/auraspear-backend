import { EntitySortField } from '../../common/enums'
import type { ListEntitiesQueryDto } from './dto/list-entities-query.dto'
import type { Prisma } from '@prisma/client'

export function buildEntitySearchWhere(
  tenantId: string,
  query: ListEntitiesQueryDto
): Prisma.EntityWhereInput {
  const where: Prisma.EntityWhereInput = { tenantId }

  if (query.type) {
    where.type = query.type
  }

  if (query.minRiskScore !== undefined) {
    where.riskScore = { gte: query.minRiskScore }
  }

  if (query.search) {
    where.OR = [
      { value: { contains: query.search, mode: 'insensitive' } },
      { displayName: { contains: query.search, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildEntityOrderBy(
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): Prisma.EntityOrderByWithRelationInput {
  switch (sortBy) {
    case EntitySortField.VALUE:
      return { value: sortOrder }
    case EntitySortField.TYPE:
      return { type: sortOrder }
    case EntitySortField.RISK_SCORE:
      return { riskScore: sortOrder }
    case EntitySortField.FIRST_SEEN:
      return { firstSeen: sortOrder }
    case EntitySortField.LAST_SEEN:
      return { lastSeen: sortOrder }
    case EntitySortField.CREATED_AT:
      return { createdAt: sortOrder }
    default:
      return { lastSeen: sortOrder }
  }
}
