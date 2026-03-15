import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

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
  }) {
    return this.prisma.aiAgent.findMany(params)
  }

  async findManyWithCounts(params: {
    where: Prisma.AiAgentWhereInput
    orderBy: Prisma.AiAgentOrderByWithRelationInput
    skip: number
    take: number
  }) {
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

  async count(where: Prisma.AiAgentWhereInput) {
    return this.prisma.aiAgent.count({ where })
  }

  async findFirst(where: Prisma.AiAgentWhereInput) {
    return this.prisma.aiAgent.findFirst({ where })
  }

  async findFirstWithDetails(where: Prisma.AiAgentWhereInput) {
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

  async findFirstSelect(where: Prisma.AiAgentWhereInput, select: Prisma.AiAgentSelect) {
    return this.prisma.aiAgent.findFirst({ where, select })
  }

  async create(data: Prisma.AiAgentUncheckedCreateInput) {
    return this.prisma.aiAgent.create({ data })
  }

  async createWithDetails(data: Prisma.AiAgentUncheckedCreateInput) {
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
    where: Prisma.AiAgentWhereUniqueInput
    data: Prisma.AiAgentUpdateInput | Record<string, unknown>
  }) {
    return this.prisma.aiAgent.update(params)
  }

  async updateWithDetails(params: {
    where: Prisma.AiAgentWhereUniqueInput
    data: Prisma.AiAgentUpdateInput | Record<string, unknown>
  }) {
    return this.prisma.aiAgent.update({
      ...params,
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

  async deleteMany(where: Prisma.AiAgentWhereInput) {
    return this.prisma.aiAgent.deleteMany({ where })
  }

  /* ---------------------------------------------------------------- */
  /* AI AGENT AGGREGATION                                               */
  /* ---------------------------------------------------------------- */

  async aggregate(params: {
    where: Prisma.AiAgentWhereInput
    _sum?: Prisma.AiAgentAggregateArgs['_sum']
  }) {
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
  }) {
    return this.prisma.aiAgentSession.findMany(params)
  }

  async countSessions(where: Prisma.AiAgentSessionWhereInput) {
    return this.prisma.aiAgentSession.count({ where })
  }
}
