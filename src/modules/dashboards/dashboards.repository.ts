import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

interface AvgMsRow {
  avg_ms: number | null
}

interface AlertTrendRow {
  date: string
  severity: string
  count: bigint
}

interface MitreTechniqueRow {
  technique: string
  count: bigint
}

interface TopAssetRow {
  hostname: string
  alert_count: bigint
  critical_count: bigint
  last_seen: Date
}

interface ConnectorRow {
  type: string
  name: string
  lastTestAt: Date | null
  lastTestOk: boolean | null
  lastError: string | null
}

@Injectable()
export class DashboardsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countOpenCases(tenantId: string): Promise<number> {
    return this.prisma.case.count({
      where: { tenantId, status: { in: ['open', 'in_progress'] } },
    })
  }

  async countAlertsSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.alert.count({
      where: { tenantId, timestamp: { gte: since } },
    })
  }

  async countResolvedAlertsSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.alert.count({
      where: {
        tenantId,
        status: { in: ['resolved', 'closed'] },
        closedAt: { gte: since },
      },
    })
  }

  async getAvgResolutionMsSince(tenantId: string, since: Date): Promise<Array<AvgMsRow>> {
    return this.prisma.$queryRaw<Array<AvgMsRow>>`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
        AND closed_at IS NOT NULL
        AND timestamp >= ${since}
    `
  }

  async countAlertsBetween(tenantId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.alert.count({
      where: { tenantId, timestamp: { gte: from, lte: to } },
    })
  }

  async countAlertsBetweenExclusiveEnd(tenantId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.alert.count({
      where: { tenantId, timestamp: { gte: from, lt: to } },
    })
  }

  async countCriticalAlertsBetween(tenantId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.alert.count({
      where: { tenantId, severity: 'critical', timestamp: { gte: from, lte: to } },
    })
  }

  async countCriticalAlertsBetweenExclusiveEnd(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<number> {
    return this.prisma.alert.count({
      where: { tenantId, severity: 'critical', timestamp: { gte: from, lt: to } },
    })
  }

  async countCasesCreatedBetween(tenantId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.case.count({
      where: { tenantId, createdAt: { gte: from, lte: to } },
    })
  }

  async countCasesCreatedBetweenExclusiveEnd(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<number> {
    return this.prisma.case.count({
      where: { tenantId, createdAt: { gte: from, lt: to } },
    })
  }

  async getAvgResolutionMsBetween(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<Array<AvgMsRow>> {
    return this.prisma.$queryRaw<Array<AvgMsRow>>`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
        AND closed_at IS NOT NULL
        AND closed_at >= ${from}
        AND closed_at <= ${to}
    `
  }

  async getAvgResolutionMsBetweenExclusiveEnd(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<Array<AvgMsRow>> {
    return this.prisma.$queryRaw<Array<AvgMsRow>>`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - timestamp)) * 1000)::float as avg_ms
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
        AND closed_at IS NOT NULL
        AND closed_at >= ${from}
        AND closed_at < ${to}
    `
  }

  async getAlertCountsByDateAndSeverity(
    tenantId: string,
    since: Date
  ): Promise<Array<AlertTrendRow>> {
    return this.prisma.$queryRaw<Array<AlertTrendRow>>`
      SELECT DATE(timestamp)::text as date, severity, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
      GROUP BY DATE(timestamp), severity
      ORDER BY date ASC
    `
  }

  async groupAlertsBySeveritySince(
    tenantId: string,
    since: Date
  ): Promise<Array<{ severity: string; _count: number }>> {
    const results = await this.prisma.alert.groupBy({
      by: ['severity'],
      where: { tenantId, timestamp: { gte: since } },
      _count: true,
    })
    return results.map(r => ({ severity: r.severity, _count: r._count }))
  }

  async getTopMitreTechniques(tenantId: string, since: Date): Promise<Array<MitreTechniqueRow>> {
    return this.prisma.$queryRaw<Array<MitreTechniqueRow>>`
      SELECT unnest(mitre_techniques) as technique, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
      GROUP BY technique
      ORDER BY count DESC
      LIMIT 10
    `
  }

  async getTopTargetedAssets(tenantId: string, since: Date): Promise<Array<TopAssetRow>> {
    return this.prisma.$queryRaw<Array<TopAssetRow>>`
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
  }

  async findEnabledConnectors(tenantId: string): Promise<Array<ConnectorRow>> {
    return this.prisma.connectorConfig.findMany({
      where: { tenantId, enabled: true },
      select: {
        type: true,
        name: true,
        lastTestAt: true,
        lastTestOk: true,
        lastError: true,
      },
    })
  }
}
