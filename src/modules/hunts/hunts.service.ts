import { Injectable, Logger } from '@nestjs/common'
import { HuntSessionStatus } from '@prisma/client'
import { RunHuntDto } from './dto/run-hunt.dto'
import { HuntsRepository } from './hunts.repository'
import {
  buildHuntEsQuery,
  mapHitsToEventData,
  extractMitreFromHits,
  countUniqueIps,
  computeThreatScore,
  buildHuntReasoning,
  generateHuntAnalysis,
  sanitizeEsQuery,
} from './hunts.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, ConnectorType } from '../../common/enums'
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

  async runHunt(tenantId: string, dto: RunHuntDto, email: string): Promise<HuntSessionRecord> {
    this.logAction('runHunt', tenantId, email, undefined, {
      query: dto.query,
      timeRange: dto.timeRange,
    })

    const session = await this.huntsRepository.createSession({
      tenantId,
      query: dto.query,
      status: HuntSessionStatus.running,
      startedBy: email,
      timeRange: dto.timeRange,
      reasoning: ['Querying Wazuh Indexer for matching events'],
    })

    const wazuhConfig = await this.connectorsService.getDecryptedConfig(
      tenantId,
      ConnectorType.WAZUH
    )
    if (!wazuhConfig) {
      return this.handleMissingConnector(session, tenantId, email)
    }

    const sanitized = this.validateAndSanitizeQuery(dto.query)
    const esQuery = buildHuntEsQuery(sanitized, dto.timeRange)

    try {
      return await this.executeHuntQuery(session, esQuery, dto, tenantId, email, wazuhConfig)
    } catch (error) {
      return this.handleHuntError(error, session, tenantId, email, dto.query)
    }
  }

  async listRuns(tenantId: string, page: number, limit: number): Promise<PaginatedHuntSessions> {
    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.huntsRepository.findSessionsPaginated(tenantId, skip, limit),
      this.huntsRepository.countSessions(tenantId),
    ])
    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  async getRun(tenantId: string, id: string): Promise<HuntSessionRecord> {
    const session = await this.huntsRepository.findSessionByIdAndTenant(id, tenantId)
    if (!session) {
      this.logWarn('getRun', tenantId, id)
      throw new BusinessException(404, `Hunt session ${id} not found`, 'errors.hunts.notFound')
    }
    return session
  }

  async getEvents(
    tenantId: string,
    sessionId: string,
    page: number,
    limit: number
  ): Promise<PaginatedHuntEvents> {
    const session = await this.huntsRepository.findSessionExistsByIdAndTenant(sessionId, tenantId)
    if (!session) {
      this.logWarn('getEvents', tenantId, sessionId)
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

    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteRun(tenantId: string, id: string, email: string): Promise<{ deleted: boolean }> {
    const session = await this.huntsRepository.findSessionByIdAndTenant(id, tenantId)
    if (!session) {
      this.logWarn('deleteRun', tenantId, id)
      throw new BusinessException(404, `Hunt session ${id} not found`, 'errors.hunts.notFound')
    }

    await this.huntsRepository.deleteSessionAndEvents(id, tenantId)

    this.logAction('deleteRun', tenantId, email, id, {
      query: session.query,
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Hunt Execution Pipeline                                  */
  /* ---------------------------------------------------------------- */

  private async executeHuntQuery(
    session: { id: string; status: HuntSessionStatus },
    esQuery: Record<string, unknown>,
    dto: RunHuntDto,
    tenantId: string,
    email: string,
    wazuhConfig: Record<string, unknown>
  ): Promise<HuntSessionRecord> {
    const result = await this.wazuhService.searchAllAlerts(wazuhConfig, esQuery)
    const eventData = await this.processHuntEvents(result.hits, session.id)

    const updated = await this.completeHuntSession(
      session, eventData, result, dto, tenantId, esQuery
    )

    this.logAction('runHunt', tenantId, email, session.id, {
      eventsFound: result.total, query: dto.query, timeRange: dto.timeRange,
    })
    return updated
  }

  private async processHuntEvents(
    hits: unknown[],
    sessionId: string
  ): Promise<ReturnType<typeof mapHitsToEventData>> {
    const eventData = mapHitsToEventData(hits, sessionId)
    if (eventData.length > 0) {
      await processChunked(eventData, 50, chunk => this.huntsRepository.createManyEvents(chunk))
    }
    return eventData
  }

  private async completeHuntSession(
    session: { id: string; status: HuntSessionStatus },
    eventData: ReturnType<typeof mapHitsToEventData>,
    result: { hits: unknown[]; total: number },
    dto: RunHuntDto,
    tenantId: string,
    esQuery: Record<string, unknown>
  ): Promise<HuntSessionRecord> {
    const analysisData = this.buildHuntAnalysisData(eventData, result, dto)

    this.assertValidTransition(session.status, HuntSessionStatus.completed)
    return this.huntsRepository.updateSessionCompletedWithEvents({
      id: session.id,
      tenantId,
      status: HuntSessionStatus.completed,
      completedAt: new Date(),
      eventsFound: result.total,
      uniqueIps: analysisData.uniqueIpCount,
      threatScore: analysisData.threatScoreValue,
      mitreTactics: analysisData.mitreTactics,
      mitreTechniques: analysisData.mitreTechniques,
      timeRange: dto.timeRange,
      executedQuery: esQuery as Prisma.InputJsonValue,
      reasoning: analysisData.reasoning,
      aiAnalysis: analysisData.aiAnalysis,
    })
  }

  private buildHuntAnalysisData(
    eventData: ReturnType<typeof mapHitsToEventData>,
    result: { hits: unknown[]; total: number },
    dto: RunHuntDto
  ): {
    uniqueIpCount: number
    threatScoreValue: number
    mitreTactics: string[]
    mitreTechniques: string[]
    reasoning: string[]
    aiAnalysis: string
  } {
    const uniqueIpCount = countUniqueIps(eventData)
    const { mitreTactics, mitreTechniques } = extractMitreFromHits(result.hits)
    const threatScoreValue = computeThreatScore(eventData, uniqueIpCount, mitreTechniques.length)

    const reasoning = buildHuntReasoning(
      dto.timeRange, result.total, uniqueIpCount, mitreTechniques, threatScoreValue
    )
    const aiAnalysis = generateHuntAnalysis(
      dto.query, result.total, uniqueIpCount, mitreTechniques, eventData
    )

    return { uniqueIpCount, threatScoreValue, mitreTactics, mitreTechniques, reasoning, aiAnalysis }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Error Handlers                                           */
  /* ---------------------------------------------------------------- */

  private async handleMissingConnector(
    session: { id: string; status: HuntSessionStatus },
    tenantId: string,
    email: string
  ): Promise<never> {
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

    this.logWarn('runHunt', tenantId, session.id, { email })
    throw new BusinessException(
      422,
      'Wazuh/OpenSearch connector is not configured for this tenant',
      'errors.hunts.searchConnectorNotConfigured'
    )
  }

  private async handleHuntError(
    error: unknown,
    session: { id: string; status: HuntSessionStatus },
    tenantId: string,
    email: string,
    _query: string
  ): Promise<never> {
    if (error instanceof BusinessException) throw error

    const errorMessage =
      error instanceof Error
        ? error.message || 'Could not connect to Wazuh Indexer — verify the service is running'
        : 'Unknown error during hunt query'

    this.logger.error(`Hunt query failed for session ${session.id}: ${errorMessage}`, { email })

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

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Validation                                               */
  /* ---------------------------------------------------------------- */

  private validateAndSanitizeQuery(query: string): string {
    const sanitized = sanitizeEsQuery(query)

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

  private assertValidTransition(from: HuntSessionStatus, to: HuntSessionStatus): void {
    const allowed = this.VALID_TRANSITIONS.get(from)
    if (!allowed?.has(to)) {
      throw new BusinessException(
        400,
        `Invalid hunt session transition from ${from} to ${to}`,
        'errors.hunts.invalidTransition'
      )
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logAction(
    action: string,
    tenantId: string,
    email: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`Hunt action: ${action}`, {
      feature: AppLogFeature.HUNTS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: action,
      targetResource: 'HuntSession',
      targetResourceId: resourceId,
      metadata,
    })
  }

  private logWarn(
    action: string,
    tenantId: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.warn(`Hunt action failed: ${action}`, {
      feature: AppLogFeature.HUNTS,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HuntsService',
      functionName: action,
      targetResource: 'HuntSession',
      targetResourceId: resourceId,
      ...metadata,
    })
  }
}
