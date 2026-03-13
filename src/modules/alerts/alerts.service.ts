import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
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
    private readonly wazuhService: WazuhService,
    private readonly appLogger: AppLoggerService
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

    try {
      const [data, total] = await Promise.all([
        this.prisma.alert.findMany({
          where,
          orderBy: this.buildAlertOrderBy(query.sortBy, query.sortOrder),
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.alert.count({ where }),
      ])

      this.appLogger.info(
        `Searched alerts page=${query.page} limit=${query.limit} total=${total}`,
        {
          feature: AppLogFeature.ALERTS,
          action: 'search',
          outcome: AppLogOutcome.SUCCESS,
          tenantId,
          sourceType: AppLogSourceType.SERVICE,
          className: 'AlertsService',
          functionName: 'search',
          metadata: {
            page: query.page,
            limit: query.limit,
            total,
            severity: query.severity ?? null,
            status: query.status ?? null,
            source: query.source ?? null,
            timeRange: query.timeRange ?? null,
            query: query.query ?? null,
          },
        }
      )

      return {
        data,
        pagination: buildPaginationMeta(query.page, query.limit, total),
      }
    } catch (error: unknown) {
      this.appLogger.error('Failed to search alerts', {
        feature: AppLogFeature.ALERTS,
        action: 'search',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'search',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
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
      this.appLogger.warn(`Alert not found id=${id}`, {
        feature: AppLogFeature.ALERTS,
        action: 'findById',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        targetResource: 'Alert',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'findById',
      })
      throw new BusinessException(404, 'Alert not found', 'errors.alerts.notFound')
    }

    this.appLogger.info(`Retrieved alert id=${id}`, {
      feature: AppLogFeature.ALERTS,
      action: 'findById',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Alert',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: 'findById',
    })

    return alert
  }

  async acknowledge(tenantId: string, id: string, email: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      this.appLogger.warn(`Cannot acknowledge closed/resolved alert id=${id}`, {
        feature: AppLogFeature.ALERTS,
        action: 'acknowledge',
        outcome: AppLogOutcome.DENIED,
        tenantId,
        actorEmail: email,
        targetResource: 'Alert',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'acknowledge',
        metadata: { currentStatus: alert.status },
      })
      throw new BusinessException(
        400,
        'Cannot acknowledge a closed alert',
        'errors.alerts.alreadyClosed'
      )
    }

    const updated = await this.prisma.alert.update({
      where: { id, tenantId },
      data: {
        status: 'acknowledged',
        acknowledgedBy: email,
        acknowledgedAt: new Date(),
      },
    })

    this.appLogger.info(`Acknowledged alert id=${id}`, {
      feature: AppLogFeature.ALERTS,
      action: 'acknowledge',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      targetResource: 'Alert',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: 'acknowledge',
    })

    return updated
  }

  async investigate(tenantId: string, id: string, _notes?: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      this.appLogger.warn(`Cannot investigate closed/resolved alert id=${id}`, {
        feature: AppLogFeature.ALERTS,
        action: 'investigate',
        outcome: AppLogOutcome.DENIED,
        tenantId,
        targetResource: 'Alert',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'investigate',
        metadata: { currentStatus: alert.status },
      })
      throw new BusinessException(
        400,
        'Cannot investigate a closed alert',
        'errors.alerts.alreadyClosed'
      )
    }

    const updated = await this.prisma.alert.update({
      where: { id, tenantId },
      data: { status: 'in_progress' },
    })

    this.appLogger.info(`Started investigation on alert id=${id}`, {
      feature: AppLogFeature.ALERTS,
      action: 'investigate',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Alert',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: 'investigate',
    })

    return updated
  }

  async close(
    tenantId: string,
    id: string,
    resolution: string,
    email: string
  ): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)

    if (alert.status === 'closed' || alert.status === 'resolved') {
      this.appLogger.warn(`Cannot close already closed/resolved alert id=${id}`, {
        feature: AppLogFeature.ALERTS,
        action: 'close',
        outcome: AppLogOutcome.DENIED,
        tenantId,
        actorEmail: email,
        targetResource: 'Alert',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'close',
        metadata: { currentStatus: alert.status },
      })
      throw new BusinessException(
        400,
        'Alert is already closed or resolved',
        'errors.alerts.alreadyClosed'
      )
    }

    const updated = await this.prisma.alert.update({
      where: { id, tenantId },
      data: {
        status: 'closed',
        resolution,
        closedAt: new Date(),
        closedBy: email,
      },
    })

    this.appLogger.info(`Closed alert id=${id} resolution="${resolution}"`, {
      feature: AppLogFeature.ALERTS,
      action: 'close',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      targetResource: 'Alert',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: 'close',
      metadata: { resolution },
    })

    return updated
  }

  /**
   * Ingest alerts from Wazuh Indexer via Elasticsearch DSL.
   * Fetches recent alerts and upserts them into the database.
   */
  async ingestFromWazuh(tenantId: string): Promise<{ ingested: number }> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'wazuh')
    if (!config) {
      this.appLogger.warn('Wazuh connector not configured for ingestion', {
        feature: AppLogFeature.ALERTS,
        action: 'ingestFromWazuh',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'ingestFromWazuh',
      })
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

    try {
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
            this.appLogger.warn('Failed to ingest individual alert from Wazuh batch', {
              feature: AppLogFeature.ALERTS,
              action: 'ingestFromWazuh',
              className: 'AlertsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.FAILURE,
              tenantId,
              metadata: { error: (batchResult.reason as Error).message },
            })
          }
        }
      }

      this.logger.log(`Ingested ${ingested} alerts from Wazuh for tenant ${tenantId}`)

      this.appLogger.info(`Ingested ${ingested} alerts from Wazuh`, {
        feature: AppLogFeature.ALERTS,
        action: 'ingestFromWazuh',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'ingestFromWazuh',
        metadata: { ingested, totalHits: upsertOps.length },
      })

      return { ingested }
    } catch (error: unknown) {
      this.appLogger.error('Failed to ingest alerts from Wazuh', {
        feature: AppLogFeature.ALERTS,
        action: 'ingestFromWazuh',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'ingestFromWazuh',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Get alert severity distribution counts for dashboard.
   */
  async getCountsBySeverity(tenantId: string): Promise<Record<string, number>> {
    try {
      const counts = await this.prisma.alert.groupBy({
        by: ['severity'],
        where: { tenantId },
        _count: true,
      })

      const result: Record<string, number> = {}
      for (const c of counts) {
        result[c.severity] = c._count
      }

      this.appLogger.info('Retrieved alert counts by severity', {
        feature: AppLogFeature.ALERTS,
        action: 'getCountsBySeverity',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getCountsBySeverity',
      })

      return result
    } catch (error: unknown) {
      this.appLogger.error('Failed to retrieve alert counts by severity', {
        feature: AppLogFeature.ALERTS,
        action: 'getCountsBySeverity',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getCountsBySeverity',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
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

    try {
      const results = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT DATE(timestamp) as date, COUNT(*)::bigint as count
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid AND timestamp >= ${since}
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `

      this.appLogger.info(`Retrieved alert trend for ${days} days`, {
        feature: AppLogFeature.ALERTS,
        action: 'getTrend',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getTrend',
        metadata: { days, dataPoints: results.length },
      })

      return results.map(r => ({ date: r.date, count: Number(r.count) }))
    } catch (error: unknown) {
      this.appLogger.error('Failed to retrieve alert trend', {
        feature: AppLogFeature.ALERTS,
        action: 'getTrend',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getTrend',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Get MITRE technique counts for dashboard.
   */
  async getMitreTechniqueCounts(
    tenantId: string
  ): Promise<Array<{ technique: string; count: number }>> {
    try {
      const results = await this.prisma.$queryRaw<Array<{ technique: string; count: bigint }>>`
        SELECT unnest(mitre_techniques) as technique, COUNT(*)::bigint as count
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY technique
        ORDER BY count DESC
        LIMIT 15
      `

      this.appLogger.info('Retrieved MITRE technique counts', {
        feature: AppLogFeature.ALERTS,
        action: 'getMitreTechniqueCounts',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getMitreTechniqueCounts',
        metadata: { techniqueCount: results.length },
      })

      return results.map(r => ({ technique: r.technique, count: Number(r.count) }))
    } catch (error: unknown) {
      this.appLogger.error('Failed to retrieve MITRE technique counts', {
        feature: AppLogFeature.ALERTS,
        action: 'getMitreTechniqueCounts',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getMitreTechniqueCounts',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  /**
   * Get top targeted assets by alert count.
   */
  async getTopTargetedAssets(
    tenantId: string,
    limit: number = 10
  ): Promise<Array<{ asset: string; count: number }>> {
    try {
      const results = await this.prisma.$queryRaw<Array<{ asset: string; count: bigint }>>`
        SELECT agent_name as asset, COUNT(*)::bigint as count
        FROM alerts
        WHERE tenant_id = ${tenantId}::uuid AND agent_name IS NOT NULL
        GROUP BY agent_name
        ORDER BY count DESC
        LIMIT ${limit}
      `

      this.appLogger.info('Retrieved top targeted assets', {
        feature: AppLogFeature.ALERTS,
        action: 'getTopTargetedAssets',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getTopTargetedAssets',
        metadata: { limit, assetCount: results.length },
      })

      return results.map(r => ({ asset: r.asset, count: Number(r.count) }))
    } catch (error: unknown) {
      this.appLogger.error('Failed to retrieve top targeted assets', {
        feature: AppLogFeature.ALERTS,
        action: 'getTopTargetedAssets',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AlertsService',
        functionName: 'getTopTargetedAssets',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
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
