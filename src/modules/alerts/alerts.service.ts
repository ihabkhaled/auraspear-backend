import { Injectable, Logger } from '@nestjs/common'
import { AlertsRepository } from './alerts.repository'
import {
  buildAlertSearchWhere,
  buildAlertOrderBy,
  buildWazuhIngestionQuery,
  buildWazuhUpsertOps,
  buildWazuhAlertCreateInput,
  countIngestedResults,
} from './alerts.utilities'
import { AlertStatus, AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { processInBatches } from '../../common/utils/batch.utility'
import { ConnectorsService } from '../connectors/connectors.service'
import { WazuhService } from '../connectors/services/wazuh.service'
import type { PaginatedAlerts, AlertRecord } from './alerts.types'
import type { SearchAlertsDto } from './dto/search-alerts.dto'

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name)

  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly connectorsService: ConnectorsService,
    private readonly wazuhService: WazuhService,
    private readonly appLogger: AppLoggerService
  ) {}

  async search(tenantId: string, query: SearchAlertsDto): Promise<PaginatedAlerts> {
    const where = buildAlertSearchWhere(tenantId, query)

    const [data, total] = await this.alertsRepository.findManyAndCount({
      where,
      orderBy: buildAlertOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    })

    this.logSuccess('search', tenantId, {
      page: query.page,
      limit: query.limit,
      total,
      severity: query.severity ?? null,
      status: query.status ?? null,
    })

    return { data, pagination: buildPaginationMeta(query.page, query.limit, total) }
  }

  async findById(tenantId: string, id: string): Promise<AlertRecord> {
    const alert = await this.alertsRepository.findFirstByIdAndTenant(id, tenantId)

    if (!alert) {
      this.logWarn('findById', tenantId, id)
      throw new BusinessException(404, 'Alert not found', 'errors.alerts.notFound')
    }

    return alert
  }

  async acknowledge(tenantId: string, id: string, email: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)
    this.ensureNotClosedOrResolved(alert, 'acknowledge', tenantId, email, id)

    const updated = await this.alertsRepository.updateByIdAndTenant(id, tenantId, {
      status: AlertStatus.ACKNOWLEDGED,
      acknowledgedBy: email,
      acknowledgedAt: new Date(),
    })

    this.logSuccess('acknowledge', tenantId, { alertId: id })
    return updated
  }

  async investigate(tenantId: string, id: string, _notes?: string): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)
    this.ensureNotClosedOrResolved(alert, 'investigate', tenantId, undefined, id)

    const updated = await this.alertsRepository.updateByIdAndTenant(id, tenantId, {
      status: AlertStatus.IN_PROGRESS,
    })

    this.logSuccess('investigate', tenantId, { alertId: id })
    return updated
  }

  async close(
    tenantId: string,
    id: string,
    resolution: string,
    email: string
  ): Promise<AlertRecord> {
    const alert = await this.findById(tenantId, id)
    this.ensureNotClosedOrResolved(alert, 'close', tenantId, email, id)

    const updated = await this.alertsRepository.updateByIdAndTenant(id, tenantId, {
      status: AlertStatus.CLOSED,
      resolution,
      closedAt: new Date(),
      closedBy: email,
    })

    this.logSuccess('close', tenantId, { alertId: id, resolution })
    return updated
  }

  /**
   * Ingest alerts from Wazuh Indexer via Elasticsearch DSL.
   */
  async ingestFromWazuh(tenantId: string): Promise<{ ingested: number }> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'wazuh')
    if (!config) {
      this.logWarn('ingestFromWazuh', tenantId)
      throw new BusinessException(
        400,
        'Wazuh connector not configured or disabled',
        'errors.alerts.connectorNotConfigured'
      )
    }

    const result = await this.wazuhService.searchAlerts(config, buildWazuhIngestionQuery())
    const upsertOps = buildWazuhUpsertOps(result.hits)

    const allResults = await processInBatches(upsertOps, 50, op => {
      const { create, update } = buildWazuhAlertCreateInput(tenantId, op)
      return this.alertsRepository.upsertByTenantAndExternalId(
        tenantId,
        op.externalId,
        create,
        update
      )
    })

    const { ingested, failures } = countIngestedResults(allResults)
    for (const message of failures) {
      this.logger.warn(`Failed to ingest alert: ${message}`)
    }

    this.logSuccess('ingestFromWazuh', tenantId, { ingested, totalHits: upsertOps.length })
    return { ingested }
  }

  async getCountsBySeverity(tenantId: string): Promise<Record<string, number>> {
    const counts = await this.alertsRepository.groupBySeverity(tenantId)
    const result: Record<string, number> = {}
    for (const c of counts) {
      result[c.severity] = c._count
    }
    return result
  }

  async getTrend(
    tenantId: string,
    days: number = 30
  ): Promise<Array<{ date: string; count: number }>> {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const results = await this.alertsRepository.queryTrend(tenantId, since)
    return results.map(r => ({ date: r.date, count: Number(r.count) }))
  }

  async getMitreTechniqueCounts(
    tenantId: string
  ): Promise<Array<{ technique: string; count: number }>> {
    const results = await this.alertsRepository.queryMitreTechniqueCounts(tenantId)
    return results.map(r => ({ technique: r.technique, count: Number(r.count) }))
  }

  async getTopTargetedAssets(
    tenantId: string,
    limit: number = 10
  ): Promise<Array<{ asset: string; count: number }>> {
    const results = await this.alertsRepository.queryTopTargetedAssets(tenantId, limit)
    return results.map(r => ({ asset: r.asset, count: Number(r.count) }))
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE HELPERS                                                   */
  /* ---------------------------------------------------------------- */

  private ensureNotClosedOrResolved(
    alert: AlertRecord,
    action: string,
    tenantId: string,
    email?: string,
    alertId?: string
  ): void {
    if (alert.status !== AlertStatus.CLOSED && alert.status !== AlertStatus.RESOLVED) {
      return
    }

    this.appLogger.warn(`Cannot ${action} closed/resolved alert`, {
      feature: AppLogFeature.ALERTS,
      action,
      outcome: AppLogOutcome.DENIED,
      tenantId,
      actorEmail: email,
      targetResource: 'Alert',
      targetResourceId: alertId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: action,
      metadata: { currentStatus: alert.status },
    })
    throw new BusinessException(
      400,
      `Cannot ${action} a closed alert`,
      'errors.alerts.alreadyClosed'
    )
  }

  private logSuccess(action: string, tenantId: string, metadata?: Record<string, unknown>): void {
    this.appLogger.info(`Alert action: ${action}`, {
      feature: AppLogFeature.ALERTS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: action,
      metadata,
    })
  }

  private logWarn(action: string, tenantId: string, resourceId?: string): void {
    this.appLogger.warn(`Alert action failed: ${action}`, {
      feature: AppLogFeature.ALERTS,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      targetResource: 'Alert',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AlertsService',
      functionName: action,
    })
  }
}
