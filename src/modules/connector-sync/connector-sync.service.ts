import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import {
  MIN_SYNC_GAP_MS,
  SYNC_INTERVAL_MS,
  SYNCABLE_TYPES,
  SYNCABLE_TYPES_SET,
} from './connector-sync.constants'
import { ConnectorSyncRepository } from './connector-sync.repository'
import { buildGraylogAlertData, countFulfilledResults } from './connector-sync.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
} from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { processInBatches } from '../../common/utils/batch.utility'
import { AlertsService } from '../alerts/alerts.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { GraylogService } from '../connectors/services/graylog.service'
import { EntityExtractionService } from '../entities/entity-extraction.service'
import { IntelService } from '../intel/intel.service'
import type { ConnectorType as PrismaConnectorType, Alert } from '@prisma/client'

@Injectable()
export class ConnectorSyncService {
  private readonly logger = new Logger(ConnectorSyncService.name)
  private running = false

  constructor(
    private readonly repository: ConnectorSyncRepository,
    private readonly connectorsService: ConnectorsService,
    private readonly alertsService: AlertsService,
    private readonly intelService: IntelService,
    private readonly graylogService: GraylogService,
    private readonly entityExtractionService: EntityExtractionService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Periodic sync entry-point — runs every SYNC_INTERVAL_MS.
   * Iterates all tenants, finds enabled + sync-eligible connectors,
   * and ingests data from each one.
   */
  @Interval(SYNC_INTERVAL_MS)
  async handleSync(): Promise<void> {
    if (this.running) {
      this.logger.debug('Sync already in progress — skipping this tick')
      return
    }

    this.running = true
    try {
      await this.syncAllTenants()
    } catch (error) {
      this.logger.error(`Global sync error: ${error instanceof Error ? error.message : 'unknown'}`)
    } finally {
      this.running = false
    }
  }

  /**
   * Manually trigger sync for a specific tenant + connector type.
   * Called from the controller when the user clicks "Sync Now".
   */
  async syncConnector(
    tenantId: string,
    type: string
  ): Promise<{ success: boolean; message: string; ingested?: number }> {
    if (!SYNCABLE_TYPES_SET.has(type)) {
      return { success: false, message: `Connector type '${type}' does not support data sync` }
    }

    try {
      const result = await this.syncSingleConnector(tenantId, type)
      return {
        success: true,
        message: `Synced ${result.ingested} records from ${type}`,
        ingested: result.ingested,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed'
      return { success: false, message }
    }
  }

  private async syncAllTenants(): Promise<void> {
    const connectors = await this.repository.findSyncableConnectors({
      enabled: true,
      syncEnabled: true,
      types: SYNCABLE_TYPES,
    })

    if (connectors.length === 0) return

    this.logger.log(`Sync tick: ${connectors.length} connector(s) eligible`)

    const results = await Promise.allSettled(
      connectors.map(async connector => {
        if (this.shouldSkipSync(connector.lastSyncAt)) return
        return this.syncSingleConnector(connector.tenantId, connector.type)
      })
    )

    this.logSyncResults(results)
  }

  private async syncSingleConnector(
    tenantId: string,
    type: string
  ): Promise<{ ingested: number }> {
    this.logSyncStart(tenantId, type)

    try {
      const ingested = await this.dispatchSync(tenantId, type)
      await this.repository.updateConnectorSyncTimestamp(tenantId, type as PrismaConnectorType)
      this.logSyncComplete(tenantId, type, ingested)
      return { ingested }
    } catch (error) {
      this.logSyncFailure(tenantId, type, error)
      throw error
    }
  }

  private async dispatchSync(tenantId: string, type: string): Promise<number> {
    switch (type) {
      case ConnectorType.WAZUH:
        return this.syncWazuh(tenantId)
      case ConnectorType.GRAYLOG:
        return this.syncGraylog(tenantId)
      case ConnectorType.MISP:
        return this.syncMisp(tenantId)
      default:
        return 0
    }
  }

  /** Ingest Wazuh alerts using the existing AlertsService method. */
  private async syncWazuh(tenantId: string): Promise<number> {
    const result = await this.alertsService.ingestFromWazuh(tenantId)
    return result.ingested
  }

  /** Ingest Graylog events as alerts. */
  private async syncGraylog(tenantId: string): Promise<number> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'graylog')
    if (!config) return 0

    const result = await this.graylogService.searchEvents(config, {
      timerange: { type: 'relative', range: 86400 },
      page: 1,
      per_page: 500,
    })

    if (result.events.length === 0) return 0

    return this.upsertGraylogAlerts(tenantId, result.events as Record<string, unknown>[])
  }

  private async upsertGraylogAlerts(
    tenantId: string,
    events: Record<string, unknown>[]
  ): Promise<number> {
    const BATCH_SIZE = 50

    const allResults = await processInBatches<Record<string, unknown>, Alert>(
      events,
      BATCH_SIZE,
      (rawEvent): Promise<Alert> => {
        const { externalId, createData, updateData } = buildGraylogAlertData(tenantId, rawEvent)
        return this.repository.upsertAlert({
          where: { tenantId_externalId: { tenantId, externalId } },
          create: createData,
          update: updateData,
        })
      }
    )

    const { fulfilled: fulfilledAlerts } = countFulfilledResults(allResults)

    if (fulfilledAlerts.length > 0) {
      await this.extractEntitiesFromGraylogAlerts(tenantId, fulfilledAlerts)
    }

    return fulfilledAlerts.length
  }

  /**
   * Extract entities from Graylog alerts (best-effort).
   */
  private async extractEntitiesFromGraylogAlerts(
    tenantId: string,
    alerts: Alert[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      alerts.map(alert =>
        this.entityExtractionService.extractFromAlert({
          tenantId,
          id: alert.id,
          sourceIp: alert.sourceIp,
          destinationIp: alert.destinationIp,
          agentName: alert.agentName,
          rawEvent: alert.rawEvent,
          title: alert.title,
          source: alert.source,
        })
      )
    )

    const { failedCount } = countFulfilledResults(results)

    if (failedCount > 0) {
      this.logger.warn(
        `Graylog entity extraction: ${failedCount}/${alerts.length} alerts failed entity extraction`
      )
    }
  }

  /** Sync MISP events + IOCs using the existing IntelService method. */
  private async syncMisp(tenantId: string): Promise<number> {
    const result = await this.intelService.syncFromMisp(tenantId)
    return result.eventsUpserted + result.iocsUpserted
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                  */
  /* ---------------------------------------------------------------- */

  private shouldSkipSync(lastSyncAt: Date | null): boolean {
    if (!lastSyncAt) return false
    const elapsed = Date.now() - lastSyncAt.getTime()
    return elapsed < MIN_SYNC_GAP_MS
  }

  private logSyncResults(results: PromiseSettledResult<unknown>[]): void {
    let succeeded = 0
    let failed = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        succeeded++
      } else {
        failed++
        this.logger.warn(`Sync failure: ${(result.reason as Error).message}`)
      }
    }

    this.logger.log(`Sync tick complete: ${succeeded} succeeded, ${failed} failed`)
  }

  private logSyncStart(tenantId: string, type: string): void {
    this.appLogger.info(`Starting sync for ${type}`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'sync',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.CRON,
      className: 'ConnectorSyncService',
      functionName: 'syncSingleConnector',
      metadata: { connectorType: type },
    })
  }

  private logSyncComplete(tenantId: string, type: string, ingested: number): void {
    this.appLogger.info(`Sync completed for ${type}: ${ingested} records`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'sync',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.CRON,
      className: 'ConnectorSyncService',
      functionName: 'syncSingleConnector',
      metadata: { connectorType: type, ingested },
    })
  }

  private logSyncFailure(tenantId: string, type: string, error: unknown): void {
    this.appLogger.error(`Sync failed for ${type}`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'sync',
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      sourceType: AppLogSourceType.CRON,
      className: 'ConnectorSyncService',
      functionName: 'syncSingleConnector',
      stackTrace: error instanceof Error ? error.stack : undefined,
      metadata: { connectorType: type },
    })
  }
}
