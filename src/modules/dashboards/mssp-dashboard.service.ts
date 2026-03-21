import { Injectable } from '@nestjs/common'
import { MsspDashboardRepository } from './mssp-dashboard.repository'
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
    const tenantIds = tenants.map(t => t.id)

    const [alertCounts, caseCounts, huntCounts] = await Promise.all([
      this.msspRepository.countAlertsByTenant(tenantIds),
      this.msspRepository.countOpenCasesByTenant(tenantIds),
      this.msspRepository.countActiveHuntsByTenant(tenantIds),
    ])

    const summaries: MsspTenantSummary[] = []

    for (const tenant of tenants) {
      const alertData = alertCounts.find(a => a.tenantId === tenant.id)
      const caseData = caseCounts.find(c => c.tenantId === tenant.id)
      const huntData = huntCounts.find(h => h.tenantId === tenant.id)
      const connectorHealth = await this.msspRepository.countConnectorHealthByTenant(tenant.id)
      const aiUsage = await this.msspRepository.countAiUsageByTenant(tenant.id)

      summaries.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        alertCount: alertData?.alertCount ?? 0,
        criticalAlerts: alertData?.criticalAlerts ?? 0,
        openCases: caseData?.openCases ?? 0,
        activeHunts: huntData?.activeHunts ?? 0,
        connectorHealth,
        aiUsage,
      })
    }

    const totalAlerts = summaries.reduce((sum, s) => sum + s.alertCount, 0)
    const totalCriticalAlerts = summaries.reduce((sum, s) => sum + s.criticalAlerts, 0)
    const totalOpenCases = summaries.reduce((sum, s) => sum + s.openCases, 0)

    this.appLogger.info('MSSP portfolio overview fetched', {
      feature: AppLogFeature.MSSP_DASHBOARD,
      action: 'getPortfolioOverview',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: 'global',
      sourceType: AppLogSourceType.SERVICE,
      className: 'MsspDashboardService',
      functionName: 'getPortfolioOverview',
      metadata: { tenantCount: tenants.length, totalAlerts, totalCriticalAlerts },
    })

    return { tenants: summaries, totalAlerts, totalCriticalAlerts, totalOpenCases }
  }

  async getTenantComparison(): Promise<MsspTenantComparison> {
    const overview = await this.getPortfolioOverview()
    return { tenants: overview.tenants }
  }
}
