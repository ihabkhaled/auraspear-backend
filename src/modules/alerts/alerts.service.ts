import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { WazuhService } from '../connectors/services/wazuh.service'
import type { PaginatedAlerts, AlertRecord } from './alerts.types'
import type { SearchAlertsDto } from './dto/search-alerts.dto'
import type { AlertSeverity, AlertStatus as PrismaAlertStatus, Prisma } from '@prisma/client'

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name)

  private static readonly VALID_SEVERITIES = new Set<string>([
    'critical',
    'high',
    'medium',
    'low',
    'info',
  ])

  private static readonly VALID_STATUSES = new Set<string>([
    'new_alert',
    'acknowledged',
    'in_progress',
    'resolved',
    'closed',
    'false_positive',
  ])

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService,
    private readonly wazuhService: WazuhService
  ) {}

  async search(tenantId: string, query: SearchAlertsDto): Promise<PaginatedAlerts> {
    const where: Prisma.AlertWhereInput = { tenantId }

    if (query.severity) {
      const severities = query.severity
        .split(',')
        .map(s => s.trim())
        .filter(s => AlertsService.VALID_SEVERITIES.has(s))
      if (severities.length === 1) {
        where.severity = severities[0] as AlertSeverity
      } else if (severities.length > 1) {
        where.severity = { in: severities as AlertSeverity[] }
      }
    }

    if (query.status && AlertsService.VALID_STATUSES.has(query.status)) {
      where.status = query.status as unknown as PrismaAlertStatus
    }

    if (query.source) {
      where.source = query.source
    }

    if (query.agentName) {
      where.agentName = { contains: query.agentName, mode: 'insensitive' }
    }

    if (query.ruleGroup) {
      where.ruleName = { contains: query.ruleGroup, mode: 'insensitive' }
    }

    // timeRange takes precedence over explicit from/to
    if (query.timeRange) {
      const now = new Date()
      const from = new Date(now)
      switch (query.timeRange) {
        case '24h':
          from.setHours(from.getHours() - 24)
          break
        case '7d':
          from.setDate(from.getDate() - 7)
          break
        case '30d':
          from.setDate(from.getDate() - 30)
          break
      }
      where.timestamp = { gte: from }
    } else if (query.from ?? query.to) {
      where.timestamp = {}
      if (query.from) {
        where.timestamp.gte = new Date(query.from)
      }
      if (query.to) {
        where.timestamp.lte = new Date(query.to)
      }
    }

    if (query.query && query.query !== '*') {
      this.applyKqlQuery(query.query, where)
    }

    const [data, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: this.buildAlertOrderBy(query.sortBy, query.sortOrder),
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

  private buildAlertOrderBy(
    sortBy: string,
    sortOrder: 'asc' | 'desc'
  ): Prisma.AlertOrderByWithRelationInput {
    switch (sortBy) {
      case 'timestamp':
        return { timestamp: sortOrder }
      case 'severity':
        return { severity: sortOrder }
      case 'status':
        return { status: sortOrder }
      case 'source':
        return { source: sortOrder }
      case 'agentName':
        return { agentName: sortOrder }
      case 'sourceIp':
        return { sourceIp: sortOrder }
      case 'title':
        return { title: sortOrder }
      case 'createdAt':
        return { createdAt: sortOrder }
      default:
        return { timestamp: 'desc' }
    }
  }

  async findById(tenantId: string, id: string): Promise<AlertRecord> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, tenantId },
    })

    if (!alert) {
      throw new BusinessException(404, 'Alert not found', 'errors.alerts.notFound')
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
      where: { id, tenantId },
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
      where: { id, tenantId },
      data: { status: 'in_progress' },
    })
  }

  async close(
    tenantId: string,
    id: string,
    resolution: string,
    email: string
  ): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      throw new BusinessException(
        400,
        'Alert is already closed or resolved',
        'errors.alerts.alreadyClosed'
      )
    }

    return this.prisma.alert.update({
      where: { id, tenantId },
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

    // Build upsert data from hits
    const upsertOps = result.hits.map(rawHit => {
      const hit = rawHit as Record<string, unknown>
      const source = (hit._source ?? hit) as Record<string, unknown>
      const externalId = (hit._id ?? source.id) as string

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

      return {
        externalId,
        rule,
        agent: agent ?? null,
        data: data ?? null,
        source,
        severity,
        mitreTactics,
        mitreTechniques,
        timestamp: new Date((source.timestamp ?? now) as string),
      }
    })

    // Batch upserts in chunks of 50 to avoid overwhelming the database
    const BATCH_SIZE = 50
    let ingested = 0

    for (let index = 0; index < upsertOps.length; index += BATCH_SIZE) {
      const batch = upsertOps.slice(index, index + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map(op =>
          this.prisma.alert.upsert({
            where: { tenantId_externalId: { tenantId, externalId: op.externalId } },
            create: {
              tenantId,
              externalId: op.externalId,
              title: (op.rule?.description ??
                op.source.rule_description ??
                'Wazuh Alert') as string,
              description: JSON.stringify(op.source),
              severity: op.severity,
              status: 'new_alert',
              source: 'wazuh',
              ruleName: (op.rule?.description ?? null) as string | null,
              ruleId: (op.rule?.id ?? null) as string | null,
              agentName:
                ((op.agent as Record<string, unknown> | null)?.name as string | null) ?? null,
              sourceIp: ((op.data as Record<string, unknown> | null)?.srcip ??
                op.source.src_ip ??
                null) as string | null,
              destinationIp: ((op.data as Record<string, unknown> | null)?.dstip ??
                op.source.dst_ip ??
                null) as string | null,
              mitreTactics: op.mitreTactics,
              mitreTechniques: op.mitreTechniques,
              rawEvent: op.source as Prisma.InputJsonValue,
              timestamp: op.timestamp,
            },
            update: {
              rawEvent: op.source as Prisma.InputJsonValue,
            },
          })
        )
      )

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          ingested++
        } else {
          this.logger.warn(`Failed to ingest alert: ${(batchResult.reason as Error).message}`)
        }
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

  /**
   * Parse a KQL-style query string and apply field filters + free-text search
   * to the given Prisma where input.
   *
   * Supported syntax:
   *   severity:critical
   *   agent.name:"web-server-01"
   *   status:new_alert AND source:wazuh
   *   free text (no field prefix → OR across text columns)
   */
  private applyKqlQuery(rawQuery: string, where: Prisma.AlertWhereInput): void {
    // Match field:value or field:"quoted value" tokens
    // Matches field:value or field:"quoted value" tokens
    // Split into two non-backtracking alternatives to avoid catastrophic backtracking
    const kqlPattern = /(\w[\w.]*):(?:"([^"]+)"|(\S+))/g
    const freeTextParts: string[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = kqlPattern.exec(rawQuery)) !== null) {
      const textBefore = rawQuery
        .slice(lastIndex, match.index)
        .replaceAll(/\b(?:AND|OR|NOT)\b/gi, '')
        .trim()
      if (textBefore) freeTextParts.push(textBefore)
      lastIndex = match.index + match[0].length

      const field = (match[1] ?? match[3] ?? '').toLowerCase()
      const value = match[2] ?? match[4] ?? ''
      this.applyKqlField(field, value, where)
    }

    const remaining = rawQuery
      .slice(lastIndex)
      .replaceAll(/\b(?:AND|OR|NOT)\b/gi, '')
      .trim()
    if (remaining) freeTextParts.push(remaining)

    const freeText = freeTextParts.join(' ').trim()
    if (freeText) {
      where.OR = [
        { title: { contains: freeText, mode: 'insensitive' } },
        { description: { contains: freeText, mode: 'insensitive' } },
        { sourceIp: { contains: freeText } },
        { destinationIp: { contains: freeText } },
        { agentName: { contains: freeText, mode: 'insensitive' } },
        { ruleName: { contains: freeText, mode: 'insensitive' } },
      ]
    }
  }

  private applyKqlField(field: string, value: string, where: Prisma.AlertWhereInput): void {
    switch (field) {
      case 'severity':
        if (AlertsService.VALID_SEVERITIES.has(value)) {
          where.severity = value as AlertSeverity
        }
        break
      case 'status':
        if (AlertsService.VALID_STATUSES.has(value)) {
          where.status = value as PrismaAlertStatus
        }
        break
      case 'source':
        where.source = value
        break
      case 'agent':
      case 'agent.name':
        where.agentName = { contains: value, mode: 'insensitive' }
        break
      case 'sourceip':
      case 'source.ip':
        where.sourceIp = { contains: value }
        break
      case 'destip':
      case 'dest.ip':
      case 'destination.ip':
        where.destinationIp = { contains: value }
        break
      case 'rule':
      case 'rule.name':
      case 'rulename':
        where.ruleName = { contains: value, mode: 'insensitive' }
        break
      default:
        break
    }
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
