import { SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { UpdateAttackPathDto } from './dto/update-attack-path.dto'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildAttackPathListWhere(
  tenantId: string,
  severity?: string,
  status?: string,
  query?: string
): Prisma.AttackPathWhereInput {
  const where: Prisma.AttackPathWhereInput = { tenantId }

  if (severity) {
    where.severity = severity as Prisma.AttackPathWhereInput['severity']
  }

  if (status) {
    where.status = status as Prisma.AttackPathWhereInput['status']
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { title: { contains: query, mode: 'insensitive' } },
      { pathNumber: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildAttackPathOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.AttackPathOrderByWithRelationInput {
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
    case 'pathNumber':
      return { pathNumber: order }
    case 'killChainCoverage':
      return { killChainCoverage: order }
    case 'title':
      return { title: order }
    case 'affectedAssets':
      return { affectedAssets: order }
    case 'detectedAt':
      return { detectedAt: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildAttackPathUpdateData(dto: UpdateAttackPathDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.title !== undefined) data['title'] = dto.title
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.severity !== undefined) data['severity'] = dto.severity
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.stages !== undefined) data['stages'] = dto.stages
  if (dto.affectedAssets !== undefined) data['affectedAssets'] = dto.affectedAssets
  if (dto.killChainCoverage !== undefined) data['killChainCoverage'] = dto.killChainCoverage
  if (dto.mitreTactics !== undefined) data['mitreTactics'] = dto.mitreTactics
  if (dto.mitreTechniques !== undefined) data['mitreTechniques'] = dto.mitreTechniques

  return data
}
