import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { HuntSessionRecord } from './hunts.types'
import type { HuntSession, HuntEvent, HuntSessionStatus, Prisma } from '@prisma/client'

interface CreateSessionInput {
  tenantId: string
  query: string
  status: HuntSessionStatus
  startedBy: string
  timeRange: string
  reasoning: string[]
}

interface UpdateSessionStatusInput {
  id: string
  tenantId: string
  status: HuntSessionStatus
  completedAt: Date
  reasoning: string[]
}

interface UpdateSessionCompletedInput {
  id: string
  tenantId: string
  status: HuntSessionStatus
  completedAt: Date
  eventsFound: number
  uniqueIps: number
  threatScore: number
  mitreTactics: string[]
  mitreTechniques: string[]
  timeRange: string
  executedQuery: Prisma.InputJsonValue
  reasoning: string[]
  aiAnalysis: string
}

interface CreateEventInput {
  huntSessionId: string
  timestamp: Date
  severity: string
  eventId: string
  sourceIp: string | null
  user: string | null
  description: string
}

@Injectable()
export class HuntsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: CreateSessionInput): Promise<HuntSession> {
    return this.prisma.huntSession.create({
      data: {
        tenantId: input.tenantId,
        query: input.query,
        status: input.status,
        startedBy: input.startedBy,
        timeRange: input.timeRange,
        reasoning: input.reasoning,
      },
    })
  }

  async updateSessionStatus(input: UpdateSessionStatusInput): Promise<void> {
    await this.prisma.huntSession.updateMany({
      where: { id: input.id, tenantId: input.tenantId },
      data: {
        status: input.status,
        completedAt: input.completedAt,
        reasoning: input.reasoning,
      },
    })
  }

  async updateSessionCompletedWithEvents(
    input: UpdateSessionCompletedInput
  ): Promise<HuntSessionRecord> {
    await this.prisma.huntSession.updateMany({
      where: { id: input.id, tenantId: input.tenantId },
      data: {
        status: input.status,
        completedAt: input.completedAt,
        eventsFound: input.eventsFound,
        uniqueIps: input.uniqueIps,
        threatScore: input.threatScore,
        mitreTactics: input.mitreTactics,
        mitreTechniques: input.mitreTechniques,
        timeRange: input.timeRange,
        executedQuery: input.executedQuery,
        reasoning: input.reasoning,
        aiAnalysis: input.aiAnalysis,
      },
    })

    return this.prisma.huntSession.findFirstOrThrow({
      where: { id: input.id, tenantId: input.tenantId },
      include: { events: true },
    })
  }

  async createManyEvents(events: CreateEventInput[]): Promise<void> {
    await this.prisma.huntEvent.createMany({ data: events })
  }

  async findSessionsPaginated(
    tenantId: string,
    skip: number,
    take: number
  ): Promise<HuntSession[]> {
    return this.prisma.huntSession.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      skip,
      take,
    })
  }

  async countSessions(tenantId: string): Promise<number> {
    return this.prisma.huntSession.count({ where: { tenantId } })
  }

  async findSessionByIdAndTenant(id: string, tenantId: string): Promise<HuntSessionRecord | null> {
    return this.prisma.huntSession.findFirst({
      where: { id, tenantId },
      include: { events: true },
    })
  }

  async findSessionExistsByIdAndTenant(
    id: string,
    tenantId: string
  ): Promise<{ id: string } | null> {
    return this.prisma.huntSession.findFirst({
      where: { id, tenantId },
      select: { id: true },
    })
  }

  async findEventsPaginated(
    huntSessionId: string,
    skip: number,
    take: number
  ): Promise<HuntEvent[]> {
    return this.prisma.huntEvent.findMany({
      where: { huntSessionId },
      orderBy: { timestamp: 'desc' },
      skip,
      take,
    })
  }

  async countEvents(huntSessionId: string): Promise<number> {
    return this.prisma.huntEvent.count({ where: { huntSessionId } })
  }
}
