import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { TenantAlertCounts, TenantCaseCounts, TenantHuntCounts } from './dashboards.types'

@Injectable()
export class MsspDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getAllTenants(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.tenant.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  async countAlertsByTenant(tenantIds: string[]): Promise<TenantAlertCounts[]> {
    const results: TenantAlertCounts[] = []

    for (const tenantId of tenantIds) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      })

      const alertCount = await this.prisma.alert.count({
        where: { tenantId },
      })

      const criticalAlerts = await this.prisma.alert.count({
        where: { tenantId, severity: 'critical' },
      })

      results.push({
        tenantId,
        tenantName: tenant?.name ?? 'Unknown',
        alertCount,
        criticalAlerts,
      })
    }

    return results
  }

  async countOpenCasesByTenant(tenantIds: string[]): Promise<TenantCaseCounts[]> {
    const results: TenantCaseCounts[] = []

    for (const tenantId of tenantIds) {
      const openCases = await this.prisma.case.count({
        where: { tenantId, status: { in: ['open', 'in_progress'] } },
      })
      results.push({ tenantId, openCases })
    }

    return results
  }

  async countActiveHuntsByTenant(tenantIds: string[]): Promise<TenantHuntCounts[]> {
    const results: TenantHuntCounts[] = []

    for (const tenantId of tenantIds) {
      const activeHunts = await this.prisma.huntSession.count({
        where: { tenantId, status: 'running' },
      })
      results.push({ tenantId, activeHunts })
    }

    return results
  }

  async countConnectorHealthByTenant(tenantId: string): Promise<number> {
    const totalConnectors = await this.prisma.connectorConfig.count({
      where: { tenantId },
    })

    if (totalConnectors === 0) {
      return 100
    }

    const healthyConnectors = await this.prisma.connectorConfig.count({
      where: { tenantId, enabled: true },
    })

    return Math.round((healthyConnectors / totalConnectors) * 100)
  }

  async countAiUsageByTenant(tenantId: string): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    return this.prisma.aiUsageLedger.count({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
    })
  }
}
