import { Injectable, Logger } from '@nestjs/common'
import { DashboardsRepository } from './dashboards.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { ConnectorsService } from '../connectors/connectors.service'

@Injectable()
export class DashboardsService {
  private readonly logger = new Logger(DashboardsService.name)

  constructor(
    private readonly dashboardsRepository: DashboardsRepository,
    private readonly connectorsService: ConnectorsService,
    private readonly appLogger: AppLoggerService
  ) {}

  private calculateTrend(currentValue: number, previousValue: number): number {
    if (previousValue === 0) {
      return currentValue > 0 ? 100 : 0
    }
    return Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10
  }

  async getSummary(tenantId: string): Promise<{
    tenantId: string
    totalAlerts: number
    criticalAlerts: number
    openCases: number
    alertsLast24h: number
    resolvedLast24h: number
    meanTimeToRespond: string
    connectedSources: number
    totalAlertsTrend: number
    criticalAlertsTrend: number
    openCasesTrend: number
    mttrTrend: number
  }> {
    this.appLogger.debug('Fetching dashboard summary', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getSummary',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getSummary',
    })

    const now = new Date()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [
      openCases,
      alertsLast24h,
      resolvedLast24h,
      avgResolutionTime,
      // Current week counts
      alertsCurrentWeek,
      criticalCurrentWeek,
      casesCurrentWeek,
      mttrCurrentWeek,
      // Previous week counts
      alertsPreviousWeek,
      criticalPreviousWeek,
      casesPreviousWeek,
      mttrPreviousWeek,
    ] = await Promise.all([
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.getAvgResolutionMsSince(tenantId, oneWeekAgo),
      // Current week
      this.dashboardsRepository.countAlertsBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.countCasesCreatedBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.getAvgResolutionMsBetween(tenantId, oneWeekAgo, now),
      // Previous week
      this.dashboardsRepository.countAlertsBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
      this.dashboardsRepository.countCriticalAlertsBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
      this.dashboardsRepository.countCasesCreatedBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
      this.dashboardsRepository.getAvgResolutionMsBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
    ])

    const avgMs = avgResolutionTime[0]?.avg_ms ?? 0
    const mttrMinutes = Math.round(avgMs / 60_000)

    const mttrCurrentMs = mttrCurrentWeek[0]?.avg_ms ?? 0
    const mttrPreviousMs = mttrPreviousWeek[0]?.avg_ms ?? 0

    const enabledConnectors = await this.connectorsService.getEnabledConnectors(tenantId)

    return {
      tenantId,
      totalAlerts: alertsCurrentWeek,
      criticalAlerts: criticalCurrentWeek,
      openCases,
      alertsLast24h,
      resolvedLast24h,
      meanTimeToRespond: mttrMinutes > 0 ? `${mttrMinutes}m` : 'N/A',
      connectedSources: enabledConnectors.length,
      totalAlertsTrend: this.calculateTrend(alertsCurrentWeek, alertsPreviousWeek),
      criticalAlertsTrend: this.calculateTrend(criticalCurrentWeek, criticalPreviousWeek),
      openCasesTrend: this.calculateTrend(casesCurrentWeek, casesPreviousWeek),
      mttrTrend: this.calculateTrend(mttrCurrentMs, mttrPreviousMs),
    }
  }

  async getAlertTrend(
    tenantId: string,
    days: number
  ): Promise<{
    tenantId: string
    days: number
    trend: Array<{
      date: string
      critical: number
      high: number
      medium: number
      low: number
      info: number
    }>
  }> {
    this.appLogger.debug('Fetching alert trend data', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getAlertTrend',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getAlertTrend',
      metadata: { days },
    })

    const since = new Date()
    since.setDate(since.getDate() - days)

    const results = await this.dashboardsRepository.getAlertCountsByDateAndSeverity(tenantId, since)

    // Pivot into { date, critical, high, medium, low, info }
    const trendMap = new Map<
      string,
      { date: string; critical: number; high: number; medium: number; low: number; info: number }
    >()

    for (const r of results) {
      if (!trendMap.has(r.date)) {
        trendMap.set(r.date, { date: r.date, critical: 0, high: 0, medium: 0, low: 0, info: 0 })
      }
      const entry = trendMap.get(r.date)
      if (entry) {
        const count = Number(r.count)
        switch (r.severity) {
          case 'critical':
            entry.critical = count
            break
          case 'high':
            entry.high = count
            break
          case 'medium':
            entry.medium = count
            break
          case 'low':
            entry.low = count
            break
          case 'info':
            entry.info = count
            break
        }
      }
    }

    return { tenantId, days, trend: [...trendMap.values()] }
  }

  async getSeverityDistribution(tenantId: string): Promise<{
    tenantId: string
    distribution: Array<{ severity: string; count: number; percentage: number }>
  }> {
    this.appLogger.debug('Fetching severity distribution', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getSeverityDistribution',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getSeverityDistribution',
    })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const counts = await this.dashboardsRepository.groupAlertsBySeveritySince(tenantId, since)

    const total = counts.reduce((sum, c) => sum + c._count, 0)

    const distribution = counts.map(c => ({
      severity: c.severity,
      count: c._count,
      percentage: total > 0 ? Math.round((c._count / total) * 1000) / 10 : 0,
    }))

    return { tenantId, distribution }
  }

  async getMitreTopTechniques(tenantId: string): Promise<{
    tenantId: string
    techniques: Array<{ id: string; count: number }>
  }> {
    this.appLogger.debug('Fetching MITRE top techniques', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getMitreTopTechniques',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getMitreTopTechniques',
    })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const results = await this.dashboardsRepository.getTopMitreTechniques(tenantId, since)

    return {
      tenantId,
      techniques: results.map(r => ({
        id: r.technique,
        count: Number(r.count),
      })),
    }
  }

  async getTopTargetedAssets(tenantId: string): Promise<{
    tenantId: string
    assets: Array<{ hostname: string; alertCount: number; criticalCount: number; lastSeen: Date }>
  }> {
    this.appLogger.debug('Fetching top targeted assets', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getTopTargetedAssets',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getTopTargetedAssets',
    })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const results = await this.dashboardsRepository.getTopTargetedAssets(tenantId, since)

    return {
      tenantId,
      assets: results.map(r => ({
        hostname: r.hostname,
        alertCount: Number(r.alert_count),
        criticalCount: Number(r.critical_count),
        lastSeen: r.last_seen,
      })),
    }
  }

  async getRecentActivity(
    tenantId: string,
    limit: number
  ): Promise<{
    data: Array<{
      id: string
      type: string
      actorName: string
      title: string
      message: string
      createdAt: Date
      isRead: boolean
    }>
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasNext: boolean
      hasPrev: boolean
    }
  }> {
    this.appLogger.debug('Fetching recent activity', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getRecentActivity',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getRecentActivity',
    })

    const [notifications, total] = await Promise.all([
      this.dashboardsRepository.findRecentNotifications(tenantId, limit),
      this.dashboardsRepository.countNotifications(tenantId),
    ])

    const actorIds = [...new Set(notifications.map(n => n.actorUserId))]
    const actors =
      actorIds.length > 0 ? await this.dashboardsRepository.findUsersByIds(actorIds) : []
    const actorMap = new Map(actors.map(a => [a.id, a]))

    const data = notifications.map(n => {
      const actor = actorMap.get(n.actorUserId)
      return {
        id: n.id,
        type: n.type,
        actorName: actor?.name ?? 'Unknown',
        title: n.title,
        message: n.message,
        createdAt: n.createdAt,
        isRead: n.readAt !== null,
      }
    })

    const totalPages = Math.ceil(total / limit)

    return {
      data,
      pagination: {
        page: 1,
        limit,
        total,
        totalPages,
        hasNext: totalPages > 1,
        hasPrev: false,
      },
    }
  }

  async getPipelineHealth(tenantId: string): Promise<{
    tenantId: string
    pipelines: Array<{
      name: string
      type: string
      status: string
      lastChecked: Date | null
      lastError: string | null
    }>
  }> {
    this.appLogger.debug('Fetching pipeline health status', {
      feature: AppLogFeature.DASHBOARD,
      action: 'getPipelineHealth',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: 'getPipelineHealth',
    })

    const connectors = await this.dashboardsRepository.findEnabledConnectors(tenantId)

    const pipelines = connectors.map(c => {
      let status = 'unknown'
      if (c.lastTestOk === true) {
        status = 'healthy'
      } else if (c.lastTestOk === false) {
        status = 'down'
      }
      return {
        name: c.name,
        type: c.type,
        status,
        lastChecked: c.lastTestAt,
        lastError: c.lastError,
      }
    })

    return { tenantId, pipelines }
  }
}
