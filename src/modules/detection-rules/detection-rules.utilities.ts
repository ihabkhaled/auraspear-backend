import type { DetectionRuleRecord, DetectionRuleStats } from './detection-rules.types'
import type { UpdateDetectionRuleDto } from './dto/update-detection-rule.dto'
import type {
  DetectionRule,
  Prisma,
  DetectionRuleType as PrismaDetectionRuleType,
  DetectionRuleSeverity as PrismaDetectionRuleSeverity,
  DetectionRuleStatus as PrismaDetectionRuleStatus,
} from '@prisma/client'

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

export function buildDetectionRuleRecord(r: DetectionRule): DetectionRuleRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    ruleNumber: r.ruleNumber,
    name: r.name,
    description: r.description,
    ruleType: r.ruleType,
    severity: r.severity,
    status: r.status,
    conditions: r.conditions as Record<string, unknown>,
    actions: r.actions as Record<string, unknown>,
    hitCount: r.hitCount,
    falsePositiveCount: r.falsePositiveCount,
    lastTriggeredAt: r.lastTriggeredAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildRuleListWhere(
  tenantId: string,
  ruleType?: string,
  severity?: string,
  status?: string,
  query?: string
): Prisma.DetectionRuleWhereInput {
  const where: Prisma.DetectionRuleWhereInput = { tenantId }

  if (ruleType) {
    where.ruleType = ruleType as PrismaDetectionRuleType
  }

  if (severity) {
    where.severity = severity as PrismaDetectionRuleSeverity
  }

  if (status) {
    where.status = status as PrismaDetectionRuleStatus
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { ruleNumber: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildRuleOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.DetectionRuleOrderByWithRelationInput {
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'

  switch (sortBy) {
    case 'name':
      return { name: order }
    case 'severity':
      return { severity: order }
    case 'status':
      return { status: order }
    case 'ruleNumber':
      return { ruleNumber: order }
    case 'ruleType':
      return { ruleType: order }
    case 'hitCount':
      return { hitCount: order }
    case 'falsePositiveCount':
      return { falsePositiveCount: order }
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

export function buildRuleUpdateData(
  dto: UpdateDetectionRuleDto
): Prisma.DetectionRuleUncheckedUpdateManyInput {
  const data: Prisma.DetectionRuleUncheckedUpdateManyInput = {}

  if (dto.name !== undefined) {
    data.name = dto.name
  }
  if (dto.description !== undefined) {
    data.description = dto.description
  }
  if (dto.ruleType !== undefined) {
    data.ruleType = dto.ruleType
  }
  if (dto.severity !== undefined) {
    data.severity = dto.severity
  }
  if (dto.status !== undefined) {
    data.status = dto.status
  }
  if (dto.conditions !== undefined) {
    data.conditions = dto.conditions as Prisma.InputJsonValue
  }
  if (dto.actions !== undefined) {
    data.actions = dto.actions as Prisma.InputJsonValue
  }

  return data
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildDetectionRuleStats(
  total: number,
  active: number,
  testing: number,
  disabled: number,
  aggregates: { _sum: { hitCount: number | null } }
): DetectionRuleStats {
  return {
    totalRules: total,
    activeRules: active,
    testingRules: testing,
    disabledRules: disabled,
    totalMatches: aggregates._sum.hitCount ?? 0,
  }
}
