import { SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { UpdatePlaybookDto } from './dto/update-playbook.dto'
import type { SoarPlaybookRecord, SoarExecutionRecord, SoarStats } from './soar.types'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildPlaybookListWhere(
  tenantId: string,
  status?: string,
  triggerType?: string,
  query?: string
): Prisma.SoarPlaybookWhereInput {
  const where: Prisma.SoarPlaybookWhereInput = { tenantId }

  if (status) {
    where.status = status as Prisma.SoarPlaybookWhereInput['status']
  }

  if (triggerType) {
    where.triggerType = triggerType as Prisma.SoarPlaybookWhereInput['triggerType']
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildPlaybookOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.SoarPlaybookOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'name':
      return { name: order }
    case 'status':
      return { status: order }
    case 'triggerType':
      return { triggerType: order }
    case 'executionCount':
      return { executionCount: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildPlaybookUpdateData(dto: UpdatePlaybookDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.name !== undefined) data['name'] = dto.name
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.triggerType !== undefined) data['triggerType'] = dto.triggerType
  if (dto.triggerConditions !== undefined) data['triggerConditions'] = dto.triggerConditions
  if (dto.steps !== undefined) data['steps'] = dto.steps
  if (dto.status !== undefined) data['status'] = dto.status

  return data
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

interface PlaybookWithTenant {
  id: string
  tenantId: string
  name: string
  description: string | null
  status: string
  triggerType: string
  triggerConditions: unknown
  steps: unknown
  executionCount: number
  lastExecutedAt: Date | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  tenant: { name: string }
}

export function buildPlaybookRecord(
  playbook: PlaybookWithTenant,
  createdByName: string | null
): SoarPlaybookRecord {
  const stepsArray = Array.isArray(playbook.steps) ? (playbook.steps as unknown[]) : []

  return {
    id: playbook.id,
    tenantId: playbook.tenantId,
    name: playbook.name,
    description: playbook.description,
    status: playbook.status,
    triggerType: playbook.triggerType,
    triggerConditions: playbook.triggerConditions as Record<string, unknown> | null,
    steps: playbook.steps as Record<string, unknown>[],
    stepsCount: stepsArray.length,
    executionCount: playbook.executionCount,
    lastExecutedAt: playbook.lastExecutedAt,
    createdBy: playbook.createdBy,
    createdByName,
    tenantName: playbook.tenant.name,
    createdAt: playbook.createdAt,
    updatedAt: playbook.updatedAt,
  }
}

interface ExecutionWithPlaybook {
  id: string
  playbookId: string
  tenantId: string
  status: string
  triggeredBy: string
  startedAt: Date
  completedAt: Date | null
  output: unknown
  error: string | null
  createdAt: Date
  playbook: { name: string }
}

export function buildExecutionRecord(
  execution: ExecutionWithPlaybook,
  triggeredByName: string | null
): SoarExecutionRecord {
  return {
    id: execution.id,
    playbookId: execution.playbookId,
    playbookName: execution.playbook.name,
    tenantId: execution.tenantId,
    status: execution.status,
    triggeredBy: execution.triggeredBy,
    triggeredByName,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    output: execution.output as Record<string, unknown> | null,
    error: execution.error,
    createdAt: execution.createdAt,
  }
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildSoarStats(
  totalPlaybooks: number,
  activePlaybooks: number,
  totalExecutions: number,
  successfulExecutions: number,
  failedExecutions: number,
  avgExecutionTimeMs: number | null
): SoarStats {
  return {
    totalPlaybooks,
    activePlaybooks,
    totalExecutions,
    successfulExecutions,
    failedExecutions,
    avgExecutionTimeMs,
  }
}
