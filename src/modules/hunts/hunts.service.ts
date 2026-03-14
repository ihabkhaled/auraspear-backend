import { Injectable, Logger } from '@nestjs/common'
import { HuntSessionStatus } from '@prisma/client'
import { RunHuntDto } from './dto/run-hunt.dto'
import {
  AlertSeverity,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { WazuhService } from '../connectors/services/wazuh.service'
import type { HuntSessionRecord, PaginatedHuntSessions, PaginatedHuntEvents } from './hunts.types'
import type { Prisma } from '@prisma/client'

@Injectable()
export class HuntsService {
  private readonly logger = new Logger(HuntsService.name)

  private readonly VALID_TRANSITIONS = new Map<HuntSessionStatus, Set<HuntSessionStatus>>([
    [HuntSessionStatus.running, new Set([HuntSessionStatus.completed, HuntSessionStatus.error])],
  ])

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService,
    private readonly wazuhService: WazuhService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Starts a new threat hunt run.
   * Creates a HuntSession in DB, queries Wazuh Indexer, stores matching events.
   */
  async runHunt(tenantId: string, dto: RunHuntDto, email: string): Promise<HuntSessionRecord> {
    this.logger.log(`User ${email} started hunt "${dto.query}" for tenant ${tenantId}`)
    this.appLogger.info('Hunt session started', {
      feature: AppLogFeature.HUNTS,
      action: 'runHunt',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: 'runHunt',
      targetResource: 'HuntSession',
      metadata: { query: dto.query, timeRange: dto.timeRange },
    })

    // Create session with status 'running'
    const session = await this.prisma.huntSession.create({
      data: {
        tenantId,
        query: dto.query,
        status: HuntSessionStatus.running,
        startedBy: email,
        timeRange: dto.timeRange,
        reasoning: ['Querying Wazuh Indexer for matching events'],
      },
    })

    // Attempt to get Wazuh connector config
    const wazuhConfig = await this.connectorsService.getDecryptedConfig(
      tenantId,
      ConnectorType.WAZUH
    )

    if (!wazuhConfig) {
      // No Wazuh connector configured — mark session as error
      this.assertValidTransition(session.status, HuntSessionStatus.error)
      await this.prisma.huntSession.update({
        where: { id: session.id },
        data: {
          status: HuntSessionStatus.error,
          completedAt: new Date(),
          reasoning: [
            'Querying Wazuh Indexer for matching events',
            'Wazuh/OpenSearch connector is not configured or not enabled for this tenant',
          ],
        },
      })

      // The session remains in DB with error status even though we throw
      this.appLogger.warn('Hunt failed — Wazuh connector not configured', {
        feature: AppLogFeature.HUNTS,
        action: 'runHunt',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorEmail: email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'HuntsService',
        functionName: 'runHunt',
        targetResource: 'HuntSession',
        targetResourceId: session.id,
        metadata: { reason: 'wazuh_connector_not_configured' },
      })
      throw new BusinessException(
        422,
        'Wazuh/OpenSearch connector is not configured for this tenant',
        'errors.hunts.searchConnectorNotConfigured'
      )
    }

    // Build Elasticsearch DSL query from the user's hunt query string
    const esQuery = this.buildEsQuery(dto.query, dto.timeRange)

    try {
      const result = await this.wazuhService.searchAlerts(wazuhConfig, esQuery)

      // Store each hit as a HuntEvent
      const eventData = result.hits.map((hit: unknown) => {
        const source = (hit as Record<string, unknown>)['_source'] as
          | Record<string, unknown>
          | undefined
        const id = (hit as Record<string, unknown>)['_id'] as string | undefined

        return {
          huntSessionId: session.id,
          timestamp: source?.timestamp ? new Date(source.timestamp as string) : new Date(),
          severity: this.extractSeverity(source),
          eventId: id ?? 'unknown',
          sourceIp: (source?.['src_ip'] ??
            source?.['data.srcip'] ??
            source?.['agent.ip'] ??
            null) as string | null,
          user: (source?.['data.dstuser'] ?? source?.['data.srcuser'] ?? null) as string | null,
          description: this.extractDescription(source),
        }
      })

      if (eventData.length > 0) {
        await this.prisma.huntEvent.createMany({ data: eventData })
      }

      // Compute unique IPs
      const ipSet = new Set<string>()
      for (const event of eventData) {
        if (event.sourceIp) {
          ipSet.add(event.sourceIp)
        }
      }
      const uniqueIpCount = ipSet.size

      // Extract MITRE from raw hits
      const tacticSet = new Set<string>()
      const techniqueSet = new Set<string>()
      for (const hit of result.hits) {
        const source = (hit as Record<string, unknown>)['_source'] as
          | Record<string, unknown>
          | undefined
        if (!source) continue
        const rule = source['rule'] as Record<string, unknown> | undefined
        if (!rule) continue
        const mitre = rule['mitre'] as Record<string, unknown> | undefined
        if (!mitre) continue
        const tactics = mitre['tactic'] as string[] | undefined
        const techniques = mitre['id'] as string[] | undefined
        if (tactics) {
          for (const t of tactics) {
            tacticSet.add(t)
          }
        }
        if (techniques) {
          for (const t of techniques) {
            techniqueSet.add(t)
          }
        }
      }

      const mitreTactics = [...tacticSet]
      const mitreTechniques = [...techniqueSet]
      const threatScoreValue = this.computeThreatScore(
        eventData,
        uniqueIpCount,
        mitreTechniques.length
      )

      const reasoning = [
        'Querying Wazuh Indexer for matching events',
        `Filtering events within ${dto.timeRange} time range`,
        'Executed query against wazuh-alerts-* index',
        `Found ${result.total} matching events`,
        `Identified ${uniqueIpCount} unique source IPs`,
        mitreTechniques.length > 0
          ? `Mapped to ${mitreTechniques.length} MITRE ATT&CK techniques: ${mitreTechniques.join(', ')}`
          : 'No MITRE ATT&CK techniques identified in results',
        `Computed threat score: ${threatScoreValue}/100`,
      ]

      // Update session to completed
      this.assertValidTransition(session.status, HuntSessionStatus.completed)
      const updated = await this.prisma.huntSession.update({
        where: { id: session.id },
        data: {
          status: HuntSessionStatus.completed,
          completedAt: new Date(),
          eventsFound: result.total,
          uniqueIps: uniqueIpCount,
          threatScore: threatScoreValue,
          mitreTactics,
          mitreTechniques,
          timeRange: dto.timeRange,
          executedQuery: esQuery as Prisma.InputJsonValue,
          reasoning,
        },
        include: { events: true },
      })

      this.appLogger.info('Hunt session completed successfully', {
        feature: AppLogFeature.HUNTS,
        action: 'runHunt',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        actorEmail: email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'HuntsService',
        functionName: 'runHunt',
        targetResource: 'HuntSession',
        targetResourceId: session.id,
        metadata: { eventsFound: result.total, query: dto.query, timeRange: dto.timeRange },
      })

      return updated
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error during hunt query'
      this.logger.error(`Hunt query failed for session ${session.id}: ${errorMessage}`)
      this.appLogger.error('Hunt query failed', {
        feature: AppLogFeature.HUNTS,
        action: 'runHunt',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorEmail: email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'HuntsService',
        functionName: 'runHunt',
        targetResource: 'HuntSession',
        targetResourceId: session.id,
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: { errorMessage, query: dto.query },
      })

      // Update session to error status
      this.assertValidTransition(session.status, HuntSessionStatus.error)
      await this.prisma.huntSession.update({
        where: { id: session.id },
        data: {
          status: HuntSessionStatus.error,
          completedAt: new Date(),
          reasoning: [
            'Querying Wazuh Indexer for matching events',
            `Query failed: ${errorMessage}`,
          ],
        },
      })

      this.appLogger.warn('Throwing BusinessException for hunt query failure', {
        feature: AppLogFeature.HUNTS,
        action: 'runHunt',
        className: 'HuntsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorEmail: email,
        targetResource: 'HuntSession',
        targetResourceId: session.id,
        metadata: { errorMessage },
      })
      throw new BusinessException(
        502,
        `Hunt query failed: ${errorMessage}`,
        'errors.hunts.queryFailed'
      )
    }
  }

  /**
   * Lists all hunt sessions for a tenant with pagination.
   */
  async listRuns(tenantId: string, page: number, limit: number): Promise<PaginatedHuntSessions> {
    this.appLogger.info('Listing hunt sessions', {
      feature: AppLogFeature.HUNTS,
      action: 'listRuns',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: 'listRuns',
      targetResource: 'HuntSession',
      metadata: { page, limit },
    })

    const [data, total] = await Promise.all([
      this.prisma.huntSession.findMany({
        where: { tenantId },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.huntSession.count({ where: { tenantId } }),
    ])

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /**
   * Gets a single hunt session by ID, scoped to tenant, with events included.
   */
  async getRun(tenantId: string, id: string): Promise<HuntSessionRecord> {
    const session = await this.prisma.huntSession.findFirst({
      where: { id, tenantId },
      include: { events: true },
    })

    if (!session) {
      this.appLogger.warn('Hunt session not found', {
        feature: AppLogFeature.HUNTS,
        action: 'getRun',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'HuntsService',
        functionName: 'getRun',
        targetResource: 'HuntSession',
        targetResourceId: id,
      })
      throw new BusinessException(404, `Hunt session ${id} not found`, 'errors.hunts.notFound')
    }

    this.appLogger.info('Retrieved hunt session', {
      feature: AppLogFeature.HUNTS,
      action: 'getRun',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: 'getRun',
      targetResource: 'HuntSession',
      targetResourceId: id,
    })

    return session
  }

  /**
   * Gets paginated events for a hunt session.
   */
  async getEvents(
    tenantId: string,
    sessionId: string,
    page: number,
    limit: number
  ): Promise<PaginatedHuntEvents> {
    // Verify session belongs to tenant before returning events
    const session = await this.prisma.huntSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    })

    if (!session) {
      this.appLogger.warn('Hunt session not found when fetching events', {
        feature: AppLogFeature.HUNTS,
        action: 'getEvents',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'HuntsService',
        functionName: 'getEvents',
        targetResource: 'HuntSession',
        targetResourceId: sessionId,
      })
      throw new BusinessException(
        404,
        `Hunt session ${sessionId} not found`,
        'errors.hunts.notFound'
      )
    }

    const [data, total] = await Promise.all([
      this.prisma.huntEvent.findMany({
        where: { huntSessionId: sessionId },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.huntEvent.count({ where: { huntSessionId: sessionId } }),
    ])

    this.appLogger.info('Retrieved hunt session events', {
      feature: AppLogFeature.HUNTS,
      action: 'getEvents',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: 'getEvents',
      targetResource: 'HuntEvent',
      targetResourceId: sessionId,
      metadata: { page, limit, totalEvents: total },
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /**
   * Validates that a hunt session status transition is allowed.
   * Terminal states (completed, error) cannot transition to anything.
   */
  private assertValidTransition(from: HuntSessionStatus, to: HuntSessionStatus): void {
    const allowed = this.VALID_TRANSITIONS.get(from)
    if (!allowed?.has(to)) {
      this.appLogger.warn(`Invalid hunt session transition from ${from} to ${to}`, {
        feature: AppLogFeature.HUNTS,
        action: 'assertValidTransition',
        className: 'HuntsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { fromStatus: from, toStatus: to },
      })
      throw new BusinessException(
        400,
        `Invalid hunt session transition from ${from} to ${to}`,
        'errors.hunts.invalidTransition'
      )
    }
  }

  /**
   * Build an Elasticsearch DSL query from a hunt query string and time range.
   */
  /**
   * Sanitize user query to prevent Elasticsearch injection.
   * Removes dangerous Lucene query syntax that could access internal indices
   * or execute scripts.
   */
  private sanitizeEsQuery(query: string): string {
    const sanitized = query
      // Remove script injection patterns
      .replaceAll(/\bscript\b/gi, '')
      // Remove internal ES API endpoint patterns
      .replaceAll(/_search|_mapping|_cluster|_cat|_nodes|_mget|_bulk|_msearch/gi, '')
      // Block match-all patterns that could return entire indices
      .replaceAll('*:*', '')
      // Block aggregation patterns that can cause memory exhaustion
      .replaceAll(/\baggregations?\b/gi, '')
      .replaceAll(/\baggs?\b/gi, '')
      // Limit length to prevent abuse
      .slice(0, 1000)
      .trim()

    if (sanitized.length === 0) {
      this.appLogger.warn('Hunt query is invalid or empty after sanitization', {
        feature: AppLogFeature.HUNTS,
        action: 'sanitizeEsQuery',
        className: 'HuntsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { originalQueryLength: query.length },
      })
      throw new BusinessException(400, 'Invalid or empty hunt query', 'errors.hunts.invalidQuery')
    }

    return sanitized
  }

  private buildEsQuery(query: string, timeRange: string): Record<string, unknown> {
    const sanitizedQuery = this.sanitizeEsQuery(query)
    const now = new Date()
    const rangeMap: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    }

    const rangeMs = rangeMap[timeRange] ?? 24 * 60 * 60 * 1000
    const from = new Date(now.getTime() - rangeMs)

    return {
      size: 500,
      query: {
        bool: {
          must: [
            {
              simple_query_string: {
                query: sanitizedQuery,
                default_operator: 'AND',
              },
            },
          ],
          filter: [
            {
              range: {
                timestamp: {
                  gte: from.toISOString(),
                  lte: now.toISOString(),
                },
              },
            },
          ],
        },
      },
      sort: [{ timestamp: { order: 'desc' } }],
    }
  }

  /**
   * Extract severity from an OpenSearch hit source.
   */
  private extractSeverity(source: Record<string, unknown> | undefined): string {
    if (!source) return AlertSeverity.INFO

    const ruleLevel = source['rule.level'] as number | undefined
    if (ruleLevel !== undefined) {
      if (ruleLevel >= 12) return AlertSeverity.CRITICAL
      if (ruleLevel >= 8) return AlertSeverity.HIGH
      if (ruleLevel >= 5) return AlertSeverity.MEDIUM
      if (ruleLevel >= 3) return AlertSeverity.LOW
      return AlertSeverity.INFO
    }

    return (source.severity as string) ?? AlertSeverity.INFO
  }

  /**
   * Extract a human-readable description from an OpenSearch hit source.
   */
  private extractDescription(source: Record<string, unknown> | undefined): string {
    if (!source) return 'No description available'

    const ruleDescription = source['rule.description'] as string | undefined
    if (ruleDescription) return ruleDescription

    const fullLog = source['full_log'] as string | undefined
    if (fullLog) return fullLog.slice(0, 500)

    const message = source['message'] as string | undefined
    if (message) return message.slice(0, 500)

    return 'No description available'
  }

  /**
   * Compute a deterministic threat score based on event severities, unique IPs, and MITRE coverage.
   */
  private computeThreatScore(
    events: Array<{ severity: string }>,
    uniqueIpCount: number,
    mitreTechCount: number
  ): number {
    if (events.length === 0) return 0

    const severityWeights: Record<string, number> = {
      [AlertSeverity.CRITICAL]: 10,
      [AlertSeverity.HIGH]: 7,
      [AlertSeverity.MEDIUM]: 4,
      [AlertSeverity.LOW]: 2,
      [AlertSeverity.INFO]: 1,
    }

    let totalWeight = 0
    let hasCritical = false
    for (const event of events) {
      const weight = severityWeights[event.severity] ?? 1
      totalWeight += weight
      if (event.severity === AlertSeverity.CRITICAL) {
        hasCritical = true
      }
    }

    const avgWeight = totalWeight / events.length
    const score = Math.floor(
      avgWeight * 12 +
        Math.min(uniqueIpCount, 10) * 2 +
        Math.min(mitreTechCount, 5) * 4 +
        (events.length >= 100 ? 10 : events.length >= 10 ? 5 : 0) +
        (hasCritical ? 15 : 0)
    )

    return Math.min(100, score)
  }
}
