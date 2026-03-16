import { Injectable, Logger } from '@nestjs/common'
import { HuntSessionStatus } from '@prisma/client'
import { RunHuntDto } from './dto/run-hunt.dto'
import { HuntsRepository } from './hunts.repository'
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
import { processChunked } from '../../common/utils/batch.utility'
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
    private readonly huntsRepository: HuntsRepository,
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
    const session = await this.huntsRepository.createSession({
      tenantId,
      query: dto.query,
      status: HuntSessionStatus.running,
      startedBy: email,
      timeRange: dto.timeRange,
      reasoning: ['Querying Wazuh Indexer for matching events'],
    })

    // Attempt to get Wazuh connector config
    const wazuhConfig = await this.connectorsService.getDecryptedConfig(
      tenantId,
      ConnectorType.WAZUH
    )

    if (!wazuhConfig) {
      // No Wazuh connector configured — mark session as error
      this.assertValidTransition(session.status, HuntSessionStatus.error)
      await this.huntsRepository.updateSessionStatus({
        id: session.id,
        tenantId,
        status: HuntSessionStatus.error,
        completedAt: new Date(),
        reasoning: [
          'Querying Wazuh Indexer for matching events',
          'Wazuh/OpenSearch connector is not configured or not enabled for this tenant',
        ],
      })

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
      const result = await this.wazuhService.searchAllAlerts(wazuhConfig, esQuery)

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
          sourceIp: this.extractNestedField(source, ['src_ip', 'data.srcip', 'agent.ip']),
          user: this.extractNestedField(source, ['data.dstuser', 'data.srcuser']),
          description: this.extractDescription(source),
        }
      })

      // Store events in chunks of 50 to avoid overwhelming Prisma
      if (eventData.length > 0) {
        await processChunked(eventData, 50, chunk => this.huntsRepository.createManyEvents(chunk))
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

      // Generate AI analysis summary for the frontend chat
      const aiAnalysis = this.generateHuntAnalysis(
        dto.query,
        result.total,
        uniqueIpCount,
        mitreTechniques,
        eventData
      )

      // Update session to completed
      this.assertValidTransition(session.status, HuntSessionStatus.completed)
      const updated = await this.huntsRepository.updateSessionCompletedWithEvents({
        id: session.id,
        tenantId,
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
        aiAnalysis,
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
      // Re-throw BusinessExceptions as-is (e.g. from sanitizeEsQuery)
      if (error instanceof BusinessException) {
        throw error
      }

      const rawMessage = error instanceof Error ? error.message : 'Unknown error during hunt query'
      const errorMessage =
        rawMessage || 'Could not connect to Wazuh Indexer — verify the service is running'
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
      await this.huntsRepository.updateSessionStatus({
        id: session.id,
        tenantId,
        status: HuntSessionStatus.error,
        completedAt: new Date(),
        reasoning: ['Querying Wazuh Indexer for matching events', `Query failed: ${errorMessage}`],
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

    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.huntsRepository.findSessionsPaginated(tenantId, skip, limit),
      this.huntsRepository.countSessions(tenantId),
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
    const session = await this.huntsRepository.findSessionByIdAndTenant(id, tenantId)

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
    const session = await this.huntsRepository.findSessionExistsByIdAndTenant(sessionId, tenantId)

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

    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.huntsRepository.findEventsPaginated(sessionId, skip, limit),
      this.huntsRepository.countEvents(sessionId),
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

  /**
   * Build an Elasticsearch DSL query from a hunt query string and time range.
   */
  private buildEsQuery(query: string, timeRange: string): Record<string, unknown> {
    const sanitizedQuery = this.sanitizeEsQuery(query)
    const now = new Date()
    const rangeMap = new Map<string, number>([
      ['1h', 60 * 60 * 1000],
      ['6h', 6 * 60 * 60 * 1000],
      ['12h', 12 * 60 * 60 * 1000],
      ['24h', 24 * 60 * 60 * 1000],
      ['7d', 7 * 24 * 60 * 60 * 1000],
      ['30d', 30 * 24 * 60 * 60 * 1000],
      ['90d', 90 * 24 * 60 * 60 * 1000],
    ])

    const rangeMs = rangeMap.get(timeRange) ?? 24 * 60 * 60 * 1000
    const from = new Date(now.getTime() - rangeMs)

    return {
      query: {
        bool: {
          must: [
            {
              simple_query_string: {
                query: sanitizedQuery,
                fields: [
                  'rule.description',
                  'rule.groups',
                  'full_log',
                  'data.srcip',
                  'data.dstuser',
                  'data.srcuser',
                  'agent.name',
                  'decoder.name',
                ],
                default_operator: 'OR',
                minimum_should_match: '1',
                lenient: true,
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
   * Resolves a dot-separated path against a nested object.
   * e.g. getNestedValue(source, 'data.srcip') → source.data.srcip
   */
  private getNestedValue(source: Record<string, unknown>, path: string): unknown {
    // First try flat key (some indices flatten to 'data.srcip')
    const sourceMap = new Map(Object.entries(source))
    if (sourceMap.has(path)) return sourceMap.get(path)

    // Then walk the nested path
    const parts = path.split('.')
    let current: unknown = source
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      const currentMap = new Map(Object.entries(current as Record<string, unknown>))
      current = currentMap.get(part)
    }
    return current
  }

  /**
   * Extracts the first non-null string value from a list of dot-paths.
   */
  private extractNestedField(
    source: Record<string, unknown> | undefined,
    paths: string[]
  ): string | null {
    if (!source) return null
    for (const path of paths) {
      const value = this.getNestedValue(source, path)
      if (typeof value === 'string' && value.length > 0) return value
    }
    return null
  }

  /**
   * Extract severity from an OpenSearch hit source.
   */
  private extractSeverity(source: Record<string, unknown> | undefined): string {
    if (!source) return AlertSeverity.INFO

    const ruleLevel = this.getNestedValue(source, 'rule.level') as number | undefined
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

    const ruleDescription = this.extractNestedField(source, ['rule.description'])
    if (ruleDescription) return ruleDescription

    const fullLog = this.extractNestedField(source, ['full_log'])
    if (fullLog) return fullLog.slice(0, 500)

    const message = this.extractNestedField(source, ['message'])
    if (message) return message.slice(0, 500)

    return 'No description available'
  }

  /**
   * Generates a dynamic AI analysis summary based on real Wazuh hunt results.
   */
  private generateHuntAnalysis(
    query: string,
    eventsFound: number,
    uniqueIps: number,
    techniques: string[],
    events: Array<{ severity: string; sourceIp: string | null; description: string }>
  ): string {
    const safeQuery = query.replaceAll(/[<>"'&]/g, '')

    // Build severity breakdown from real data
    const severityCounts: Record<string, number> = {}
    for (const event of events) {
      severityCounts[event.severity] = (severityCounts[event.severity] ?? 0) + 1
    }
    const severityBreakdown = Object.entries(severityCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([severity, count]) => `- **${severity.toUpperCase()}**: ${count} event(s)`)
      .join('\n')

    // Build top source IPs from real data
    const ipCounts: Record<string, number> = {}
    for (const event of events) {
      if (event.sourceIp) {
        ipCounts[event.sourceIp] = (ipCounts[event.sourceIp] ?? 0) + 1
      }
    }
    const topIps = Object.entries(ipCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ip, count]) => `- \`${ip}\` — ${count} event(s)`)
      .join('\n')

    // Build unique descriptions from real data
    const uniqueDescriptions = [...new Set(events.map(e => e.description))]
      .slice(0, 5)
      .map(desc => `- ${desc}`)
      .join('\n')

    const threatScore = this.computeThreatScore(events, uniqueIps, techniques.length)

    return `## Threat Hunt Analysis: "${safeQuery}"

**Summary:** Found **${eventsFound} events** across **${uniqueIps} unique source IP(s)** with a threat score of **${threatScore}/100**.

**Severity Breakdown:**
${severityBreakdown || '- No events found'}

**Top Source IPs:**
${topIps || '- No source IPs identified'}

**Event Types Detected:**
${uniqueDescriptions || '- No descriptions available'}

${techniques.length > 0 ? `**MITRE ATT&CK Coverage:** ${techniques.join(', ')}` : '**MITRE ATT&CK Coverage:** No techniques mapped from results'}

**Recommended Actions:**
1. ${eventsFound > 20 ? 'High event volume detected — prioritize triage of critical and high severity events' : 'Review all matching events for indicators of compromise'}
2. ${uniqueIps > 3 ? `Investigate the ${uniqueIps} unique source IPs for malicious activity` : 'Check source IPs against threat intelligence feeds'}
3. ${techniques.length > 0 ? `Map findings to MITRE ATT&CK techniques: ${techniques.join(', ')}` : 'Manually map findings to MITRE ATT&CK framework for coverage analysis'}
4. Cross-reference with related alerts and cases for correlation
5. Document findings and escalate if true positive indicators are confirmed`
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

    let volumeBonus = 0
    if (events.length >= 100) {
      volumeBonus = 10
    } else if (events.length >= 10) {
      volumeBonus = 5
    }

    const avgWeight = totalWeight / events.length
    const score = Math.floor(
      avgWeight * 12 +
        Math.min(uniqueIpCount, 10) * 2 +
        Math.min(mitreTechCount, 5) * 4 +
        volumeBonus +
        (hasCritical ? 15 : 0)
    )

    return Math.min(100, score)
  }
}
