import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'

@Injectable()
export class DashboardsService {
  private readonly logger = new Logger(DashboardsService.name)

  constructor(
    private readonly prisma: PrismaService,
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
      this.prisma.case.count({ where: { tenantId, status: { in: ['open', 'in_progress'] } } }),
      this.prisma.alert.count({
        where: {
          tenantId,
          timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.alert.count({
        where: {
          tenantId,
          status: { in: ['resolved', 'closed'] },
          closedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid
          AND closed_at IS NOT NULL
          AND timestamp >= ${oneWeekAgo}
      `,
      // Current week alert count
      this.prisma.alert.count({
        where: { tenantId, timestamp: { gte: oneWeekAgo, lte: now } },
      }),
      // Current week critical alert count
      this.prisma.alert.count({
        where: { tenantId, severity: 'critical', timestamp: { gte: oneWeekAgo, lte: now } },
      }),
      // Current week cases opened
      this.prisma.case.count({
        where: { tenantId, createdAt: { gte: oneWeekAgo, lte: now } },
      }),
      // Current week MTTR
      this.prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid
          AND closed_at IS NOT NULL
          AND closed_at >= ${oneWeekAgo}
          AND closed_at <= ${now}
      `,
      // Previous week alert count
      this.prisma.alert.count({
        where: { tenantId, timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo } },
      }),
      // Previous week critical alert count
      this.prisma.alert.count({
        where: { tenantId, severity: 'critical', timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo } },
      }),
      // Previous week cases opened
      this.prisma.case.count({
        where: { tenantId, createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } },
      }),
      // Previous week MTTR
      this.prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid
          AND closed_at IS NOT NULL
          AND closed_at >= ${twoWeeksAgo}
          AND closed_at < ${oneWeekAgo}
      `,
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

    const results = await this.prisma.$queryRaw<
      Array<{ date: string; severity: string; count: bigint }>
    >`
      SELECT DATE(timestamp)::text as date, severity, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
      GROUP BY DATE(timestamp), severity
      ORDER BY date ASC
    `

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

    const counts = await this.prisma.alert.groupBy({
      by: ['severity'],
      where: { tenantId, timestamp: { gte: since } },
      _count: true,
    })

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

    const results = await this.prisma.$queryRaw<Array<{ technique: string; count: bigint }>>`
      SELECT unnest(mitre_techniques) as technique, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
      GROUP BY technique
      ORDER BY count DESC
      LIMIT 10
    `

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

    const results = await this.prisma.$queryRaw<
      Array<{ hostname: string; alert_count: bigint; critical_count: bigint; last_seen: Date }>
    >`
      SELECT
        agent_name as hostname,
        COUNT(*)::bigint as alert_count,
        COUNT(*) FILTER (WHERE severity = 'critical')::bigint as critical_count,
        MAX(timestamp) as last_seen
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
        AND agent_name IS NOT NULL
        AND timestamp >= ${since}
      GROUP BY agent_name
      ORDER BY alert_count DESC
      LIMIT 10
    `

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

    const connectors = await this.prisma.connectorConfig.findMany({
      where: { tenantId, enabled: true },
      select: {
        type: true,
        name: true,
        lastTestAt: true,
        lastTestOk: true,
        lastError: true,
      },
    })

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
