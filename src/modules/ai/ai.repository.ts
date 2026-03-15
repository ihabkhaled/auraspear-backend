import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Alert, Prisma } from '@prisma/client'

export interface CreateAiAuditLogData {
  tenantId: string
  actor: string
  action: string
  model: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  prompt?: string
  response?: string
}

@Injectable()
export class AiRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEnabledConnectorByType(tenantId: string, type: string) {
    return this.prisma.connectorConfig.findFirst({
      where: {
        tenantId,
        type: type as Prisma.EnumConnectorTypeFilter,
        enabled: true,
      },
    })
  }

  async createAuditLog(data: CreateAiAuditLogData): Promise<void> {
    await this.prisma.aiAuditLog.create({ data })
  }

  async findAlertByIdAndTenant(alertId: string, tenantId: string): Promise<Alert | null> {
    return this.prisma.alert.findFirst({
      where: { id: alertId, tenantId },
    })
  }

  async findRelatedAlerts(
    tenantId: string,
    excludeAlertId: string,
    sinceDate: Date,
    orConditions: Prisma.AlertWhereInput[]
  ): Promise<Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>> {
    return this.prisma.alert.findMany({
      where: {
        tenantId,
        id: { not: excludeAlertId },
        timestamp: { gte: sinceDate },
        OR: orConditions,
      },
      select: {
        id: true,
        title: true,
        severity: true,
        timestamp: true,
      },
      take: 20,
      orderBy: { timestamp: 'desc' },
    })
  }
}
