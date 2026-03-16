import type { CorrelationStats } from './correlation.types'
import type { UpdateRuleDto } from './dto/update-rule.dto'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildRuleListWhere(
  tenantId: string,
  source?: string,
  severity?: string,
  status?: string,
  query?: string
): Prisma.CorrelationRuleWhereInput {
  const where: Prisma.CorrelationRuleWhereInput = { tenantId }

  if (source) {
    const sources = source.split(',').map(s => s.trim())
    where.source = { in: sources as Prisma.EnumRuleSourceFilter['in'] }
  }

  if (severity) {
    const severities = severity.split(',').map(s => s.trim())
    where.severity = { in: severities as Prisma.EnumRuleSeverityFilter['in'] }
  }

  if (status) {
    const statuses = status.split(',').map(s => s.trim())
    where.status = { in: statuses as Prisma.EnumRuleStatusFilter['in'] }
  }

  if (query) {
    where.OR = [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      { ruleNumber: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildRuleOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.CorrelationRuleOrderByWithRelationInput {
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'

  switch (sortBy) {
    case 'title':
      return { title: order }
    case 'severity':
      return { severity: order }
    case 'status':
      return { status: order }
    case 'ruleNumber':
      return { ruleNumber: order }
    case 'hitCount':
      return { hitCount: order }
    case 'source':
      return { source: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'createdAt':
    default:
      return { createdAt: order }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildRuleUpdateData(dto: UpdateRuleDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.title !== undefined) data['title'] = dto.title
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.source !== undefined) data['source'] = dto.source
  if (dto.severity !== undefined) data['severity'] = dto.severity
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.yamlContent !== undefined) data['yamlContent'] = dto.yamlContent
  if (dto.conditions !== undefined) data['conditions'] = dto.conditions
  if (dto.mitreTactics !== undefined) data['mitreTactics'] = dto.mitreTactics
  if (dto.mitreTechniques !== undefined) data['mitreTechniques'] = dto.mitreTechniques

  return data
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildCorrelationStats(
  correlationRules: number,
  sigmaRules: number,
  fired24hResult: { _sum?: { hitCount?: number | null } | null },
  linkedResult: { _sum?: { linkedIncidents?: number | null } | null }
): CorrelationStats {
  return {
    correlationRules,
    sigmaRules,
    fired24h: fired24hResult._sum?.hitCount ?? 0,
    linkedToIncidents: linkedResult._sum?.linkedIncidents ?? 0,
  }
}
