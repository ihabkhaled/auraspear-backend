import { SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { AgentWithRelations, AiAgentRecord } from './ai-agents.types'
import type { UpdateAgentToolDto } from './dto/agent-tool.dto'
import type { UpdateAgentDto } from './dto/update-agent.dto'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

export function buildAgentRecord(agent: AgentWithRelations): AiAgentRecord {
  const { _count, sessions, tools, ...rest } = agent
  return {
    ...rest,
    totalTokens: String(agent['totalTokens'] ?? 0),
    toolsCount: _count.tools,
    sessionsCount: _count.sessions,
    tools,
    recentSessions: sessions,
  } as AiAgentRecord
}

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildAgentListWhere(
  tenantId: string,
  status?: string,
  tier?: string,
  query?: string
): Prisma.AiAgentWhereInput {
  const where: Prisma.AiAgentWhereInput = { tenantId }

  if (status) {
    where.status = status as Prisma.AiAgentWhereInput['status']
  }

  if (tier) {
    where.tier = tier as Prisma.AiAgentWhereInput['tier']
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      { model: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildAgentOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.AiAgentOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'name':
      return { name: order }
    case 'model':
      return { model: order }
    case 'status':
      return { status: order }
    case 'tier':
      return { tier: order }
    case 'totalTasks':
      return { totalTasks: order }
    case 'totalTokens':
      return { totalTokens: order }
    case 'totalCost':
      return { totalCost: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildAgentUpdateData(dto: UpdateAgentDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.name !== undefined) data['name'] = dto.name
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.model !== undefined) data['model'] = dto.model
  if (dto.tier !== undefined) data['tier'] = dto.tier
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.soulMd !== undefined) data['soulMd'] = dto.soulMd

  return data
}

/* ---------------------------------------------------------------- */
/* TOOL UPDATE DATA BUILDING                                         */
/* ---------------------------------------------------------------- */

export function buildToolUpdateData(dto: UpdateAgentToolDto): Record<string, unknown> {
  const updateData: Record<string, unknown> = {}
  if (dto.name !== undefined) {
    updateData['name'] = dto.name
  }
  if (dto.description !== undefined) {
    updateData['description'] = dto.description
  }
  if (dto.schema !== undefined) {
    updateData['schema'] = JSON.parse(JSON.stringify(dto.schema))
  }
  return updateData
}
