import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'

@Injectable()
export class DashboardsService {
  private readonly logger = new Logger(DashboardsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService
  ) {}

  async getSummary(tenantId: string): Promise<{
    tenantId: string
    totalAlerts: number
    criticalAlerts: number
    highAlerts: number
    openCases: number
    alertsLast24h: number
    resolvedLast24h: number
    meanTimeToRespond: string
    connectedSources: number
  }> {
    const [
      totalAlerts,
      criticalAlerts,
      highAlerts,
      openCases,
      alertsLast24h,
      resolvedLast24h,
      avgResolutionTime,
    ] = await Promise.all([
      this.prisma.alert.count({ where: { tenantId } }),
      this.prisma.alert.count({ where: { tenantId, severity: 'critical' } }),
      this.prisma.alert.count({ where: { tenantId, severity: 'high' } }),
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
        WHERE tenant_id = ${tenantId}::uuid AND closed_at IS NOT NULL
      `,
    ])

    const avgMs = avgResolutionTime[0]?.avg_ms ?? 0
    const mttrMinutes = Math.round(avgMs / 60_000)

    const enabledConnectors = await this.connectorsService.getEnabledConnectors(tenantId)

    return {
      tenantId,
      totalAlerts,
      criticalAlerts,
      highAlerts,
      openCases,
      alertsLast24h,
      resolvedLast24h,
      meanTimeToRespond: mttrMinutes > 0 ? `${mttrMinutes}m` : 'N/A',
      connectedSources: enabledConnectors.length,
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
        const sev = r.severity
        if (sev in entry && sev !== 'date') {
          const mutable = entry as Record<string, string | number>
          mutable[sev] = Number(r.count)
        }
      }
    }

    return { tenantId, days, trend: [...trendMap.values()] }
  }

  async getSeverityDistribution(tenantId: string): Promise<{
    tenantId: string
    distribution: Array<{ severity: string; count: number; percentage: number }>
  }> {
    const counts = await this.prisma.alert.groupBy({
      by: ['severity'],
      where: { tenantId },
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
    const results = await this.prisma.$queryRaw<Array<{ technique: string; count: bigint }>>`
      SELECT unnest(mitre_techniques) as technique, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
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
    const results = await this.prisma.$queryRaw<
      Array<{ hostname: string; alert_count: bigint; critical_count: bigint; last_seen: Date }>
    >`
      SELECT
        agent_name as hostname,
        COUNT(*)::bigint as alert_count,
        COUNT(*) FILTER (WHERE severity = 'critical')::bigint as critical_count,
        MAX(timestamp) as last_seen
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND agent_name IS NOT NULL
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

    const pipelines = connectors.map(c => ({
      name: c.name,
      type: c.type,
      status: c.lastTestOk === true ? 'healthy' : c.lastTestOk === false ? 'down' : 'unknown',
      lastChecked: c.lastTestAt,
      lastError: c.lastError,
    }))

    return { tenantId, pipelines }
  }
}
