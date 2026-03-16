import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { AiAgent, AiAgentSession, Prisma } from '@prisma/client'

@Injectable()
export class AiAgentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* AI AGENT QUERIES                                                   */
  /* ---------------------------------------------------------------- */

  async findMany(params: {
    where: Prisma.AiAgentWhereInput
    orderBy: Prisma.AiAgentOrderByWithRelationInput
    skip: number
    take: number
  }): Promise<AiAgent[]> {
    return this.prisma.aiAgent.findMany(params)
  }

  async findManyWithCounts(params: {
    where: Prisma.AiAgentWhereInput
    orderBy: Prisma.AiAgentOrderByWithRelationInput
    skip: number
    take: number
  }): Promise<(AiAgent & { _count: { tools: number; sessions: number } })[]> {
    return this.prisma.aiAgent.findMany({
      ...params,
      include: {
        _count: {
          select: {
            tools: true,
            sessions: true,
          },
        },
      },
    })
  }

  async count(where: Prisma.AiAgentWhereInput): Promise<number> {
    return this.prisma.aiAgent.count({ where })
  }

  async findFirst(where: Prisma.AiAgentWhereInput): Promise<AiAgent | null> {
    return this.prisma.aiAgent.findFirst({ where })
  }

  async findFirstWithDetails(where: Prisma.AiAgentWhereInput): Promise<Prisma.AiAgentGetPayload<{
    include: {
      tools: true
      sessions: true
      _count: { select: { tools: true; sessions: true } }
    }
  }> | null> {
    return this.prisma.aiAgent.findFirst({
      where,
      include: {
        tools: true,
        sessions: {
          orderBy: { startedAt: 'desc' } as const,
          take: 10,
        },
        _count: {
          select: {
            tools: true,
            sessions: true,
          },
        },
      },
    })
  }

  async findFirstSelect(
    where: Prisma.AiAgentWhereInput,
    select: Prisma.AiAgentSelect
  ): Promise<Partial<AiAgent> | null> {
    return this.prisma.aiAgent.findFirst({ where, select })
  }

  async create(data: Prisma.AiAgentUncheckedCreateInput): Promise<AiAgent> {
    return this.prisma.aiAgent.create({ data })
  }

  async createWithDetails(data: Prisma.AiAgentUncheckedCreateInput): Promise<
    Prisma.AiAgentGetPayload<{
      include: {
        tools: true
        sessions: true
        _count: { select: { tools: true; sessions: true } }
      }
    }>
  > {
    return this.prisma.aiAgent.create({
      data,
      include: {
        tools: true,
        sessions: {
          orderBy: { startedAt: 'desc' } as const,
          take: 10,
        },
        _count: {
          select: {
            tools: true,
            sessions: true,
          },
        },
      },
    })
  }

  async update(params: {
    where: { id: string; tenantId: string }
    data: Prisma.AiAgentUpdateManyMutationInput | Record<string, unknown>
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.aiAgent.updateMany({
      where: params.where,
      data: params.data,
    })
  }

  async updateWithDetails(params: {
    where: { id: string; tenantId: string }
    data: Prisma.AiAgentUpdateManyMutationInput | Record<string, unknown>
  }): Promise<
    Prisma.AiAgentGetPayload<{
      include: {
        tools: true
        sessions: true
        _count: { select: { tools: true; sessions: true } }
      }
    }>
  > {
    await this.prisma.aiAgent.updateMany({
      where: params.where,
      data: params.data,
    })

    const updated = await this.prisma.aiAgent.findFirst({
      where: params.where,
      include: {
        tools: true,
        sessions: {
          orderBy: { startedAt: 'desc' } as const,
          take: 10,
        },
        _count: {
          select: {
            tools: true,
            sessions: true,
          },
        },
      },
    })

    if (!updated) {
      throw new Error(`AiAgent ${params.where.id} not found after update`)
    }

    return updated
  }

  async deleteMany(where: Prisma.AiAgentWhereInput): Promise<Prisma.BatchPayload> {
    return this.prisma.aiAgent.deleteMany({ where })
  }

  /* ---------------------------------------------------------------- */
  /* AI AGENT AGGREGATION                                               */
  /* ---------------------------------------------------------------- */

  async aggregate(params: {
    where: Prisma.AiAgentWhereInput
    _sum?: Prisma.AiAgentAggregateArgs['_sum']
  }): Promise<
    Prisma.GetAiAgentAggregateType<{
      where: Prisma.AiAgentWhereInput
      _sum: Prisma.AiAgentAggregateArgs['_sum']
    }>
  > {
    return this.prisma.aiAgent.aggregate({
      where: params.where,
      _sum: params._sum,
    })
  }

  /* ---------------------------------------------------------------- */
  /* AI AGENT SESSION QUERIES                                           */
  /* ---------------------------------------------------------------- */

  async findManySessions(params: {
    where: Prisma.AiAgentSessionWhereInput
    skip: number
    take: number
    orderBy: Prisma.AiAgentSessionOrderByWithRelationInput
  }): Promise<AiAgentSession[]> {
    return this.prisma.aiAgentSession.findMany(params)
  }

  async countSessions(where: Prisma.AiAgentSessionWhereInput): Promise<number> {
    return this.prisma.aiAgentSession.count({ where })
  }
}
