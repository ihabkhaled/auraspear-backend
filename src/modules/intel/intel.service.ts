import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { MispService } from '../connectors/services/misp.service'
import type {
  PaginatedMispEvents,
  PaginatedIOCs,
  IOCMatchResult,
  IntelStatsResponse,
} from './intel.types'
import type { Prisma } from '@prisma/client'

@Injectable()
export class IntelService {
  private readonly logger = new Logger(IntelService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService,
    private readonly mispService: MispService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Returns aggregated IOC and threat actor counts for the tenant.
   */
  async getStats(tenantId: string): Promise<IntelStatsResponse> {
    const [iocCounts, threatActorCount] = await Promise.all([
      this.prisma.intelIOC.groupBy({
        by: ['iocType'],
        where: { tenantId, active: true },
        _count: { id: true },
      }),
      this.prisma.intelMispEvent.findMany({
        where: { tenantId },
        select: { organization: true },
        distinct: ['organization'],
      }),
    ])

    const countByType = new Map<string, number>()
    for (const group of iocCounts) {
      countByType.set(group.iocType, group._count.id)
    }

    const ipIOCs = (countByType.get('ip-src') ?? 0) + (countByType.get('ip-dst') ?? 0)

    const fileHashes =
      (countByType.get('md5') ?? 0) +
      (countByType.get('sha1') ?? 0) +
      (countByType.get('sha256') ?? 0)

    const activeDomains = (countByType.get('domain') ?? 0) + (countByType.get('hostname') ?? 0)

    let totalIOCs = 0
    for (const group of iocCounts) {
      totalIOCs += group._count.id
    }

    this.appLogger.info('Retrieved intel stats', {
      feature: AppLogFeature.INTEL,
      action: 'getStats',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'getStats',
      targetResource: 'IntelStats',
      metadata: {
        totalIOCs,
        threatActors: threatActorCount.length,
        ipIOCs,
        fileHashes,
        activeDomains,
      },
    })

    return {
      threatActors: threatActorCount.length,
      ipIOCs,
      fileHashes,
      activeDomains,
      totalIOCs,
    }
  }

  /**
   * Returns recent MISP events from the database, paginated and optionally sorted.
   */
  async getRecentEvents(
    tenantId: string,
    page: number = 1,
    limit: number = 20,
    sortBy?: string,
    sortOrder?: string
  ): Promise<PaginatedMispEvents> {
    const where: Prisma.IntelMispEventWhereInput = { tenantId }

    const [data, total] = await Promise.all([
      this.prisma.intelMispEvent.findMany({
        where,
        orderBy: this.buildMispOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.intelMispEvent.count({ where }),
    ])

    this.appLogger.info('Retrieved recent MISP events', {
      feature: AppLogFeature.INTEL,
      action: 'getRecentEvents',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'getRecentEvents',
      targetResource: 'IntelMispEvent',
      metadata: { page, limit, totalEvents: total, sortBy, sortOrder },
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /**
   * Search IOCs by value, with optional type and source filters.
   * Supports sorting by any IOC field.
   */
  async searchIOCs(
    tenantId: string,
    query?: string,
    type?: string,
    page: number = 1,
    limit: number = 20,
    sortBy?: string,
    sortOrder?: string,
    source?: string
  ): Promise<PaginatedIOCs> {
    const where: Prisma.IntelIOCWhereInput = { tenantId, active: true }

    if (query && query.trim().length > 0) {
      where.iocValue = { contains: query, mode: 'insensitive' }
    }

    if (type) {
      const expanded = this.expandIocTypeFilter(type)
      if (expanded.length === 1) {
        where.iocType = expanded[0]
      } else if (expanded.length > 1) {
        where.iocType = { in: expanded }
      }
    }

    if (source) {
      where.source = { contains: source, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      this.prisma.intelIOC.findMany({
        where,
        orderBy: this.buildIOCOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.intelIOC.count({ where }),
    ])

    this.appLogger.info('Searched IOCs', {
      feature: AppLogFeature.INTEL,
      action: 'searchIOCs',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'searchIOCs',
      targetResource: 'IntelIOC',
      metadata: { query, type, source, page, limit, totalResults: total, sortBy, sortOrder },
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /**
   * Cross-reference IOC values against alert sourceIp/destinationIp fields.
   * Finds active IOCs for the tenant and checks which ones match the
   * source or destination IP of the given alerts.
   */
  async matchIOCsAgainstAlerts(tenantId: string, alertIds: string[]): Promise<IOCMatchResult[]> {
    this.appLogger.info('Matching IOCs against alerts', {
      feature: AppLogFeature.INTEL,
      action: 'matchIOCsAgainstAlerts',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'matchIOCsAgainstAlerts',
      targetResource: 'Alert',
      metadata: { alertCount: alertIds.length },
    })

    const alerts = await this.prisma.alert.findMany({
      where: { tenantId, id: { in: alertIds } },
      select: { id: true, sourceIp: true, destinationIp: true },
    })

    // Collect all unique IP addresses from the alerts
    const ipSet = new Set<string>()
    for (const alert of alerts) {
      if (alert.sourceIp) {
        ipSet.add(alert.sourceIp)
      }
      if (alert.destinationIp) {
        ipSet.add(alert.destinationIp)
      }
    }

    const ips = [...ipSet]

    // Find IOCs whose values match any of the collected IPs
    const matchingIOCs =
      ips.length > 0
        ? await this.prisma.intelIOC.findMany({
            where: {
              tenantId,
              active: true,
              iocValue: { in: ips },
            },
          })
        : []

    // Build a lookup map: IP -> IOC records
    const iocByValue = new Map<
      string,
      Array<{ iocValue: string; iocType: string; source: string; severity: string }>
    >()
    for (const ioc of matchingIOCs) {
      const existing = iocByValue.get(ioc.iocValue) ?? []
      existing.push({
        iocValue: ioc.iocValue,
        iocType: ioc.iocType,
        source: ioc.source,
        severity: ioc.severity,
      })
      iocByValue.set(ioc.iocValue, existing)
    }

    this.appLogger.info('IOC matching completed', {
      feature: AppLogFeature.INTEL,
      action: 'matchIOCsAgainstAlerts',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'matchIOCsAgainstAlerts',
      targetResource: 'IntelIOC',
      metadata: { matchingIOCsFound: matchingIOCs.length, uniqueIPs: ips.length },
    })

    // Map each alert to its matched IOCs
    return alertIds.map(alertId => {
      const alert = alerts.find(a => a.id === alertId)
      if (!alert) {
        return { alertId, matchedIOCs: [], matchCount: 0 }
      }

      const matched: Array<{
        iocValue: string
        iocType: string
        source: string
        severity: string
      }> = []

      if (alert.sourceIp && iocByValue.has(alert.sourceIp)) {
        matched.push(...(iocByValue.get(alert.sourceIp) ?? []))
      }
      if (alert.destinationIp && iocByValue.has(alert.destinationIp)) {
        matched.push(...(iocByValue.get(alert.destinationIp) ?? []))
      }

      // Deduplicate by iocValue + iocType
      const seen = new Set<string>()
      const deduped = matched.filter(entry => {
        const key = `${entry.iocValue}:${entry.iocType}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })

      return { alertId, matchedIOCs: deduped, matchCount: deduped.length }
    })
  }

  /**
   * Sync events and IOCs from a MISP instance into the local database.
   * Fetches events via MispService, upserts IntelMispEvent rows,
   * then fetches attributes and upserts IntelIOC rows.
   */
  async syncFromMisp(tenantId: string): Promise<{ eventsUpserted: number; iocsUpserted: number }> {
    this.appLogger.info('MISP sync started', {
      feature: AppLogFeature.INTEL,
      action: 'syncFromMisp',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'syncFromMisp',
      targetResource: 'IntelMispEvent',
    })

    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'misp')
    if (!config) {
      this.appLogger.warn('MISP sync failed — connector not configured', {
        feature: AppLogFeature.INTEL,
        action: 'syncFromMisp',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'IntelService',
        functionName: 'syncFromMisp',
        targetResource: 'IntelMispEvent',
        metadata: { reason: 'misp_connector_not_configured' },
      })
      throw new BusinessException(
        400,
        'MISP connector not configured or disabled',
        'errors.intel.mispNotConfigured'
      )
    }

    let eventsUpserted = 0
    let iocsUpserted = 0

    try {
      // --- Sync events ---
      const rawEvents = await this.mispService.getEvents(config, 50)
      const eventUpserts = this.buildEventUpserts(tenantId, rawEvents)
      const eventResults = await Promise.allSettled(
        eventUpserts.map(upsert => this.prisma.intelMispEvent.upsert(upsert))
      )

      for (const result of eventResults) {
        if (result.status === 'fulfilled') {
          eventsUpserted++
        }
      }

      // --- Sync attributes (IOCs) ---
      const attributes = await this.mispService.searchAttributes(config, {
        limit: 500,
        page: 1,
        type: ['ip-src', 'ip-dst', 'domain', 'hostname', 'md5', 'sha1', 'sha256', 'url'],
      })

      const iocUpserts = this.buildIOCUpserts(tenantId, attributes)
      const iocResults = await Promise.allSettled(
        iocUpserts.map(upsert => this.prisma.intelIOC.upsert(upsert))
      )

      for (const result of iocResults) {
        if (result.status === 'fulfilled') {
          iocsUpserted++
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`MISP sync failed for tenant ${tenantId}: ${message}`)
      this.appLogger.error('MISP sync failed', {
        feature: AppLogFeature.INTEL,
        action: 'syncFromMisp',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'IntelService',
        functionName: 'syncFromMisp',
        targetResource: 'IntelMispEvent',
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: { errorMessage: message },
      })

      if (error instanceof BusinessException) {
        throw error
      }

      this.appLogger.warn('Throwing BusinessException for MISP sync failure', {
        feature: AppLogFeature.INTEL,
        action: 'syncFromMisp',
        className: 'IntelService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        metadata: { errorMessage: message },
      })
      throw new BusinessException(502, `MISP sync failed: ${message}`, 'errors.intel.syncFailed')
    }

    this.logger.log(
      `MISP sync complete for tenant ${tenantId}: ${eventsUpserted} events, ${iocsUpserted} IOCs`
    )
    this.appLogger.info('MISP sync completed successfully', {
      feature: AppLogFeature.INTEL,
      action: 'syncFromMisp',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'IntelService',
      functionName: 'syncFromMisp',
      targetResource: 'IntelMispEvent',
      metadata: { eventsUpserted, iocsUpserted },
    })
    return { eventsUpserted, iocsUpserted }
  }

  /**
   * Build Prisma upsert arguments for MISP events.
   */
  private buildEventUpserts(
    tenantId: string,
    rawEvents: unknown[]
  ): Array<Prisma.IntelMispEventUpsertArgs> {
    const upserts: Array<Prisma.IntelMispEventUpsertArgs> = []

    for (const rawEvent of rawEvents) {
      const event = rawEvent as Record<string, unknown>
      const mispEventId = String(event.id ?? event.event_id ?? '')
      if (!mispEventId) {
        continue
      }

      const tags = (event.Tag ?? event.tags ?? []) as unknown[]
      const orgInfo = event.Orgc as Record<string, unknown> | undefined
      const organization = String(orgInfo?.name ?? event.org ?? event.orgc_name ?? 'Unknown')
      const threatLevel = this.mapThreatLevel(event.threat_level_id as string | number | undefined)
      const info = String(event.info ?? '')
      const date = new Date(String(event.date ?? new Date().toISOString()))
      const attributeCount = Number(event.attribute_count ?? 0)
      const published = Boolean(event.published)

      upserts.push({
        where: { tenantId_mispEventId: { tenantId, mispEventId } },
        create: {
          tenantId,
          mispEventId,
          organization,
          threatLevel,
          info,
          date,
          tags: tags as Prisma.InputJsonValue,
          attributeCount,
          published,
        },
        update: {
          organization,
          threatLevel,
          info,
          date,
          tags: tags as Prisma.InputJsonValue,
          attributeCount,
          published,
        },
      })
    }

    return upserts
  }

  /**
   * Build Prisma upsert arguments for IOC attributes.
   */
  private buildIOCUpserts(
    tenantId: string,
    rawAttributes: unknown[]
  ): Array<Prisma.IntelIOCUpsertArgs> {
    const upserts: Array<Prisma.IntelIOCUpsertArgs> = []

    for (const rawAttribute of rawAttributes) {
      const attribute = rawAttribute as Record<string, unknown>
      const iocValue = String(attribute.value ?? '')
      const iocType = String(attribute.type ?? 'unknown')

      if (!iocValue) {
        continue
      }

      const attributeTags = (attribute.Tag ?? []) as Array<Record<string, unknown>>
      const tagNames = attributeTags.map(tag => String(tag.name ?? '')).filter(Boolean)

      // Derive source from event_id
      const eventId = attribute.event_id as string | undefined
      const source = eventId ? `MISP-${eventId}` : 'MISP'
      const severity = this.mapAttributeSeverity(attribute)

      const firstSeen = new Date(
        String(attribute.first_seen ?? attribute.timestamp ?? new Date().toISOString())
      )
      const lastSeen = new Date(
        String(attribute.last_seen ?? attribute.timestamp ?? new Date().toISOString())
      )

      upserts.push({
        where: { tenantId_iocValue_iocType: { tenantId, iocValue, iocType } },
        create: {
          tenantId,
          iocValue,
          iocType,
          source,
          severity,
          hitCount: 0,
          firstSeen,
          lastSeen,
          tags: tagNames,
          active: true,
        },
        update: {
          source,
          severity,
          lastSeen,
          tags: tagNames,
        },
      })
    }

    return upserts
  }

  /**
   * Expand a broad IOC type filter into specific DB iocType values.
   * e.g. 'ip' → ['ip-src', 'ip-dst'], 'hash' → ['md5', 'sha1', 'sha256']
   */
  private expandIocTypeFilter(type: string): string[] {
    const TYPE_GROUPS: Record<string, string[]> = {
      ip: ['ip-src', 'ip-dst'],
      hash: ['md5', 'sha1', 'sha256'],
    }

    const group = TYPE_GROUPS[type]
    if (group) {
      return group
    }

    return [type]
  }

  /**
   * Build Prisma orderBy for IntelIOC queries.
   * Allowed sort fields: lastSeen, firstSeen, hitCount, severity, iocType, iocValue, source.
   */
  private buildIOCOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.IntelIOCOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'lastSeen':
        return { lastSeen: order }
      case 'firstSeen':
        return { firstSeen: order }
      case 'hitCount':
        return { hitCount: order }
      case 'severity':
        return { severity: order }
      case 'iocType':
        return { iocType: order }
      case 'iocValue':
        return { iocValue: order }
      case 'source':
        return { source: order }
      default:
        return { lastSeen: 'desc' }
    }
  }

  /**
   * Build Prisma orderBy for IntelMispEvent queries.
   * Allowed sort fields: date, organization, threatLevel, attributeCount, published.
   */
  private buildMispOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.IntelMispEventOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'date':
        return { date: order }
      case 'organization':
        return { organization: order }
      case 'threatLevel':
        return { threatLevel: order }
      case 'attributeCount':
        return { attributeCount: order }
      case 'published':
        return { published: order }
      default:
        return { date: 'desc' }
    }
  }

  /**
   * Map MISP threat_level_id (1-4) to a human-readable string.
   * 1 = high, 2 = medium, 3 = low, 4 = undefined
   */
  private mapThreatLevel(level: string | number | undefined): string {
    const parsed = Number(level)
    if (parsed === 1) return 'high'
    if (parsed === 2) return 'medium'
    if (parsed === 3) return 'low'
    return 'undefined'
  }

  /**
   * Derive a severity label from MISP attribute metadata.
   * Uses IDS flag and category as heuristics.
   */
  private mapAttributeSeverity(attribute: Record<string, unknown>): string {
    const toIds = attribute.to_ids as boolean | undefined
    const category = String(attribute.category ?? '').toLowerCase()

    if (toIds && (category.includes('payload') || category.includes('artifacts'))) {
      return 'critical'
    }
    if (toIds) {
      return 'high'
    }
    if (category.includes('network') || category.includes('external')) {
      return 'medium'
    }
    return 'low'
  }
}
