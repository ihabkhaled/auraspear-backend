import { Injectable } from '@nestjs/common'
import { MsspDashboardRepository } from './mssp-dashboard.repository'
import { buildPortfolioOverview } from './mssp-dashboard.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  MsspPortfolioOverview,
  MsspTenantComparison,
  MsspTenantSummary,
} from '../entities/entities.types'

@Injectable()
export class MsspDashboardService {
  constructor(
    private readonly msspRepository: MsspDashboardRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async getPortfolioOverview(): Promise<MsspPortfolioOverview> {
    const tenants = await this.msspRepository.getAllTenants()
    const summaries = await this.buildTenantSummaries(tenants)
    const overview = buildPortfolioOverview(summaries)

    this.appLogger.info('MSSP portfolio overview fetched', {
      feature: AppLogFeature.MSSP_DASHBOARD,
      action: 'getPortfolioOverview',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: 'global',
      sourceType: AppLogSourceType.SERVICE,
      className: 'MsspDashboardService',
      functionName: 'getPortfolioOverview',
      metadata: {
        tenantCount: tenants.length,
        totalAlerts: overview.totalAlerts,
        totalCriticalAlerts: overview.totalCriticalAlerts,
      },
    })

    return overview
  }

  async getTenantComparison(): Promise<MsspTenantComparison> {
    const overview = await this.getPortfolioOverview()
    return { tenants: overview.tenants }
  }

  private async buildTenantSummaries(
    tenants: Array<{ id: string; name: string }>
  ): Promise<MsspTenantSummary[]> {
    const tenantIds = tenants.map(t => t.id)

    const [alertCounts, caseCounts, huntCounts] = await Promise.all([
      this.msspRepository.countAlertsByTenant(tenantIds),
      this.msspRepository.countOpenCasesByTenant(tenantIds),
      this.msspRepository.countActiveHuntsByTenant(tenantIds),
    ])

    return Promise.all(
      tenants.map(async tenant =>
        this.buildSingleTenantSummary(tenant, alertCounts, caseCounts, huntCounts)
      )
    )
  }

  private async buildSingleTenantSummary(
    tenant: { id: string; name: string },
    alertCounts: Array<{ tenantId: string; alertCount: number; criticalAlerts: number }>,
    caseCounts: Array<{ tenantId: string; openCases: number }>,
    huntCounts: Array<{ tenantId: string; activeHunts: number }>
  ): Promise<MsspTenantSummary> {
    const alertData = alertCounts.find(a => a.tenantId === tenant.id)
    const caseData = caseCounts.find(c => c.tenantId === tenant.id)
    const huntData = huntCounts.find(h => h.tenantId === tenant.id)
    const [connectorHealth, aiUsage] = await Promise.all([
      this.msspRepository.countConnectorHealthByTenant(tenant.id),
      this.msspRepository.countAiUsageByTenant(tenant.id),
    ])

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      alertCount: alertData?.alertCount ?? 0,
      criticalAlerts: alertData?.criticalAlerts ?? 0,
      openCases: caseData?.openCases ?? 0,
      activeHunts: huntData?.activeHunts ?? 0,
      connectorHealth,
      aiUsage,
    }
  }
}
