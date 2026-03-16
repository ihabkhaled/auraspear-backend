import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ConnectorSyncRepository } from './connector-sync.repository'
import {
  AlertSeverity,
  AlertStatus,
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
import { IntelService } from '../intel/intel.service'
import type { ConnectorType as PrismaConnectorType, Alert, Prisma } from '@prisma/client'

/** Sync runs every 2 minutes (120 000 ms). */
const SYNC_INTERVAL_MS = 120_000

/** Minimum gap between syncs for the same connector (90 seconds). */
const MIN_SYNC_GAP_MS = 90_000

/** Connectors whose data we can ingest automatically. */
const SYNCABLE_TYPES: ConnectorType[] = [
  ConnectorType.WAZUH,
  ConnectorType.GRAYLOG,
  ConnectorType.MISP,
]
const SYNCABLE_TYPES_SET = new Set<string>(SYNCABLE_TYPES)

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

    if (connectors.length === 0) {
      return
    }

    this.logger.log(`Sync tick: ${connectors.length} connector(s) eligible`)

    const results = await Promise.allSettled(
      connectors.map(async connector => {
        // Skip if synced too recently
        if (connector.lastSyncAt) {
          const elapsed = Date.now() - connector.lastSyncAt.getTime()
          if (elapsed < MIN_SYNC_GAP_MS) {
            return
          }
        }

        return this.syncSingleConnector(connector.tenantId, connector.type)
      })
    )

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

  private async syncSingleConnector(tenantId: string, type: string): Promise<{ ingested: number }> {
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

    let ingested = 0

    try {
      switch (type) {
        case ConnectorType.WAZUH:
          ingested = await this.syncWazuh(tenantId)
          break
        case ConnectorType.GRAYLOG:
          ingested = await this.syncGraylog(tenantId)
          break
        case ConnectorType.MISP:
          ingested = await this.syncMisp(tenantId)
          break
        default:
          break
      }

      // Update lastSyncAt timestamp
      await this.repository.updateConnectorSyncTimestamp(tenantId, type as PrismaConnectorType)

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
    } catch (error) {
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
      throw error
    }

    return { ingested }
  }

  /** Ingest Wazuh alerts using the existing AlertsService method. */
  private async syncWazuh(tenantId: string): Promise<number> {
    const result = await this.alertsService.ingestFromWazuh(tenantId)
    return result.ingested
  }

  /** Ingest Graylog events as alerts. */
  private async syncGraylog(tenantId: string): Promise<number> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, 'graylog')
    if (!config) {
      return 0
    }

    const result = await this.graylogService.searchEvents(config, {
      timerange: { type: 'relative', range: 86400 },
      page: 1,
      per_page: 500,
    })

    if (result.events.length === 0) {
      return 0
    }

    const BATCH_SIZE = 50

    const allResults = await processInBatches<Record<string, unknown>, Alert>(
      result.events as Record<string, unknown>[],
      BATCH_SIZE,
      (rawEvent): Promise<Alert> => {
        const wrapper = rawEvent as Record<string, unknown>
        const event = (wrapper.event ?? wrapper) as Record<string, unknown>
        const externalId = (event.id ?? `graylog-${Date.now()}-${Math.random()}`) as string
        const message = (event.message ?? event.key ?? 'Graylog Event') as string
        const priority = (event.priority ?? 2) as number
        const timestamp = new Date((event.timestamp ?? new Date().toISOString()) as string)
        const source_ = (event.source ?? '') as string

        return this.repository.upsertAlert({
          where: { tenantId_externalId: { tenantId, externalId } },
          create: {
            tenantId,
            externalId,
            title: message,
            description: JSON.stringify(event),
            severity: this.mapGraylogPriority(priority),
            status: AlertStatus.NEW_ALERT,
            source: 'graylog',
            ruleName: (event.event_definition_id ?? null) as string | null,
            ruleId: (event.event_definition_id ?? null) as string | null,
            agentName: source_ || null,
            sourceIp: (event.source_ip ?? null) as string | null,
            destinationIp: null,
            mitreTactics: [],
            mitreTechniques: [],
            rawEvent: event as Prisma.InputJsonValue,
            timestamp,
          },
          update: {
            rawEvent: event as Prisma.InputJsonValue,
          },
        })
      }
    )

    let ingested = 0
    for (const batchResult of allResults) {
      if (batchResult.status === 'fulfilled') {
        ingested++
      }
    }

    return ingested
  }

  /** Sync MISP events + IOCs using the existing IntelService method. */
  private async syncMisp(tenantId: string): Promise<number> {
    const result = await this.intelService.syncFromMisp(tenantId)
    return result.eventsUpserted + result.iocsUpserted
  }

  private mapGraylogPriority(priority: number): AlertSeverity {
    if (priority >= 4) return AlertSeverity.CRITICAL
    if (priority >= 3) return AlertSeverity.HIGH
    if (priority >= 2) return AlertSeverity.MEDIUM
    if (priority >= 1) return AlertSeverity.LOW
    return AlertSeverity.INFO
  }
}
