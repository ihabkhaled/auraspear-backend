import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { WazuhService } from '../connectors/services/wazuh.service'
import type { PaginatedAlerts, AlertRecord } from './alerts.types'
import type { SearchAlertsDto } from './dto/search-alerts.dto'
import type { Prisma } from '@prisma/client'

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService,
    private readonly wazuhService: WazuhService
  ) {}

  async search(tenantId: string, query: SearchAlertsDto): Promise<PaginatedAlerts> {
    const where: Prisma.AlertWhereInput = { tenantId }

    if (query.severity) {
      where.severity = query.severity as Prisma.EnumAlertSeverityFilter
    }

    if (query.status) {
      where.status = query.status as Prisma.EnumAlertStatusFilter
    }

    if (query.source) {
      where.source = query.source
    }

    if (query.from || query.to) {
      where.timestamp = {}
      if (query.from) {
        where.timestamp.gte = new Date(query.from)
      }
      if (query.to) {
        where.timestamp.lte = new Date(query.to)
      }
    }

    if (query.query && query.query !== '*') {
      where.OR = [
        { title: { contains: query.query, mode: 'insensitive' } },
        { description: { contains: query.query, mode: 'insensitive' } },
        { sourceIp: { contains: query.query } },
        { destinationIp: { contains: query.query } },
        { agentName: { contains: query.query, mode: 'insensitive' } },
        { ruleName: { contains: query.query, mode: 'insensitive' } },
      ]
    }

    const orderBy: Prisma.AlertOrderByWithRelationInput = {}
    const sortField = query.sortBy as keyof Prisma.AlertOrderByWithRelationInput
    orderBy[sortField] = query.sortOrder

    const [data, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.alert.count({ where }),
    ])

    return {
      data,
      pagination: buildPaginationMeta(query.page, query.limit, total),
    }
  }

  async findById(tenantId: string, id: string): Promise<AlertRecord> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, tenantId },
    })

    if (!alert) {
      throw new NotFoundException('Alert not found')
    }

    return alert
  }

  async acknowledge(tenantId: string, id: string, email: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      throw new BusinessException(
        400,
        'Cannot acknowledge a closed alert',
        'errors.alerts.alreadyClosed'
      )
    }

    return this.prisma.alert.update({
      where: { id },
      data: {
        status: 'acknowledged',
        acknowledgedBy: email,
        acknowledgedAt: new Date(),
      },
    })
  }

  async investigate(tenantId: string, id: string, _notes?: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      throw new BusinessException(
        400,
        'Cannot investigate a closed alert',
        'errors.alerts.alreadyClosed'
      )
    }

    return this.prisma.alert.update({
      where: { id },
      data: { status: 'in_progress' },
    })
  }

  async close(
    tenantId: string,
    id: string,
    resolution: string,
    email: string
  ): Promise<AlertRecord> {
    await this.findById(tenantId, id)

    return this.prisma.alert.update({
      where: { id },
      data: {
        status: 'closed',
        resolution,
        closedAt: new Date(),
        closedBy: email,
      },
    })
  }

  /**
   * Ingest alerts from Wazuh Indexer via Elasticsearch DSL.
   * Fetches recent alerts and upserts them into the database.
   */
  async ingestFromWazuh(tenantId: string): Promise<{ ingested: number }> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'wazuh')
    if (!config) {
      throw new BusinessException(
        400,
        'Wazuh connector not configured or disabled',
        'errors.alerts.connectorNotConfigured'
      )
    }

    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const esQuery = {
      size: 500,
      query: {
        bool: {
          must: [
            { range: { timestamp: { gte: oneDayAgo.toISOString(), lte: now.toISOString() } } },
          ],
        },
      },
      sort: [{ timestamp: { order: 'desc' } }],
    }

    const result = await this.wazuhService.searchAlerts(config, esQuery)

    let ingested = 0
    for (const rawHit of result.hits) {
      const hit = rawHit as Record<string, unknown>
      const source = (hit._source ?? hit) as Record<string, unknown>
      const externalId = (hit._id ?? source.id) as string

      try {
        const rule = source.rule as Record<string, unknown> | undefined
        const agent = source.agent as Record<string, unknown> | undefined
        const data = source.data as Record<string, unknown> | undefined

        const mitreTechniques: string[] = []
        const mitreTactics: string[] = []
        const mitreInfo = rule?.mitre as Record<string, unknown> | undefined
        if (mitreInfo) {
          const ids = mitreInfo.id as string[] | undefined
          const tactics = mitreInfo.tactic as string[] | undefined
          if (ids) mitreTechniques.push(...ids)
          if (tactics) mitreTactics.push(...tactics)
        }

        const severity = this.mapWazuhLevel(rule?.level as number | undefined)

        await this.prisma.alert.upsert({
          where: { tenantId_externalId: { tenantId, externalId } },
          create: {
            tenantId,
            externalId,
            title: (rule?.description ?? source.rule_description ?? 'Wazuh Alert') as string,
            description: JSON.stringify(source),
            severity,
            status: 'new_alert',
            source: 'wazuh',
            ruleName: (rule?.description ?? null) as string | null,
            ruleId: (rule?.id ?? null) as string | null,
            agentName: (agent?.name ?? null) as string | null,
            sourceIp: (data?.srcip ?? source.src_ip ?? null) as string | null,
            destinationIp: (data?.dstip ?? source.dst_ip ?? null) as string | null,
            mitreTactics,
            mitreTechniques,
            rawEvent: source as Prisma.InputJsonValue,
            timestamp: new Date((source.timestamp ?? now) as string),
          },
          update: {
            rawEvent: source as Prisma.InputJsonValue,
          },
        })

        ingested++
      } catch (error) {
        this.logger.warn(`Failed to ingest alert ${externalId}: ${(error as Error).message}`)
      }
    }

    this.logger.log(`Ingested ${ingested} alerts from Wazuh for tenant ${tenantId}`)
    return { ingested }
  }

  /**
   * Get alert severity distribution counts for dashboard.
   */
  async getCountsBySeverity(tenantId: string): Promise<Record<string, number>> {
    const counts = await this.prisma.alert.groupBy({
      by: ['severity'],
      where: { tenantId },
      _count: true,
    })

    const result: Record<string, number> = {}
    for (const c of counts) {
      result[c.severity] = c._count
    }
    return result
  }

  /**
   * Get alert trend over days for dashboard.
   */
  async getTrend(
    tenantId: string,
    days: number = 30
  ): Promise<Array<{ date: string; count: number }>> {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const results = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE(timestamp) as date, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `

    return results.map(r => ({ date: r.date, count: Number(r.count) }))
  }

  /**
   * Get MITRE technique counts for dashboard.
   */
  async getMitreTechniqueCounts(
    tenantId: string
  ): Promise<Array<{ technique: string; count: number }>> {
    const results = await this.prisma.$queryRaw<Array<{ technique: string; count: bigint }>>`
      SELECT unnest(mitre_techniques) as technique, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid
      GROUP BY technique
      ORDER BY count DESC
      LIMIT 15
    `

    return results.map(r => ({ technique: r.technique, count: Number(r.count) }))
  }

  /**
   * Get top targeted assets by alert count.
   */
  async getTopTargetedAssets(
    tenantId: string,
    limit: number = 10
  ): Promise<Array<{ asset: string; count: number }>> {
    const results = await this.prisma.$queryRaw<Array<{ asset: string; count: bigint }>>`
      SELECT agent_name as asset, COUNT(*)::bigint as count
      FROM alerts
      WHERE tenant_id = ${tenantId}::uuid AND agent_name IS NOT NULL
      GROUP BY agent_name
      ORDER BY count DESC
      LIMIT ${limit}
    `

    return results.map(r => ({ asset: r.asset, count: Number(r.count) }))
  }

  private mapWazuhLevel(
    level: number | undefined
  ): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    if (!level) return 'info'
    if (level >= 12) return 'critical'
    if (level >= 8) return 'high'
    if (level >= 5) return 'medium'
    if (level >= 3) return 'low'
    return 'info'
  }
}
