import { Injectable, Logger } from '@nestjs/common'
import { CLASS_NAME } from './data-explorer.constants'
import { DataExplorerRepository } from './data-explorer.repository'
import {
  buildFluxQuery,
  buildGrafanaDashboardWhere,
  buildLogstashLogWhere,
  buildMispSearchParameters,
  buildShuffleWorkflowWhere,
  buildSyncJobWhere,
  buildSyncSummaryMap,
  buildVelociraptorEndpointWhere,
  buildVelociraptorHuntWhere,
  countBatchResults,
  isMispAttributeSearch,
  mapConnectorOverview,
  mapGrafanaDashboardUpsert,
  mapLogstashPipelineEntry,
  mapShuffleWorkflowUpsert,
  mapVelociraptorEndpointUpsert,
  mapVelociraptorHuntUpsert,
} from './data-explorer.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
  LogLevel,
  SyncJobStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { processInBatches } from '../../common/utils/batch.utility'
import { sanitizeEsQueryString } from '../../common/utils/es-sanitize.utility'
import { ConnectorsService } from '../connectors/connectors.service'
import { GrafanaService } from '../connectors/services/grafana.service'
import { GraylogService } from '../connectors/services/graylog.service'
import { InfluxDBService } from '../connectors/services/influxdb.service'
import { LogstashService } from '../connectors/services/logstash.service'
import { MispService } from '../connectors/services/misp.service'
import { ShuffleService } from '../connectors/services/shuffle.service'
import { VelociraptorService } from '../connectors/services/velociraptor.service'
import type {
  ExplorerOverview,
  PaginatedGrafanaDashboards,
  PaginatedLogstashLogs,
  PaginatedShuffleWorkflows,
  PaginatedSyncJobs,
  PaginatedUnknownResult,
  PaginatedVelociraptorEndpoints,
  PaginatedVelociraptorHunts,
} from './data-explorer.types'
import type {
  GraylogSearchDto,
  GrafanaDashboardQueryDto,
  InfluxDBQueryDto,
  MispEventQueryDto,
  VelociraptorEndpointQueryDto,
  VelociraptorHuntQueryDto,
  ShuffleWorkflowQueryDto,
  LogstashLogQueryDto,
  SyncJobQueryDto,
} from './dto/explorer-query.dto'
import type { ConnectorSyncJob } from '@prisma/client'

@Injectable()
export class DataExplorerService {
  private readonly logger = new Logger(DataExplorerService.name)

  constructor(
    private readonly repository: DataExplorerRepository,
    private readonly connectorsService: ConnectorsService,
    private readonly graylogService: GraylogService,
    private readonly grafanaService: GrafanaService,
    private readonly influxDBService: InfluxDBService,
    private readonly mispService: MispService,
    private readonly velociraptorService: VelociraptorService,
    private readonly shuffleService: ShuffleService,
    private readonly logstashService: LogstashService,
    private readonly appLogger: AppLoggerService
  ) {}

  // ── Overview ───────────────────────────────────────────────────────

  async getOverview(tenantId: string): Promise<ExplorerOverview> {
    const [connectors, syncSummary] = await Promise.all([
      this.repository.findConnectorConfigs(tenantId),
      this.repository.groupBySyncJobStatus(tenantId),
    ])

    const summaryMap = buildSyncSummaryMap(syncSummary)
    this.logAction('getOverview', tenantId, {})

    return {
      connectors: mapConnectorOverview(connectors),
      syncJobsSummary: {
        running: summaryMap.get('running') ?? { count: 0, connectors: [] },
        completed: summaryMap.get('completed') ?? { count: 0, connectors: [] },
        failed: summaryMap.get('failed') ?? { count: 0, connectors: [] },
      },
    }
  }

  // ── Graylog ───────────────────────────────────────────────────────

  async searchGraylogLogs(
    tenantId: string,
    dto: GraylogSearchDto
  ): Promise<PaginatedUnknownResult> {
    const config = await this.getConfig(tenantId, ConnectorType.GRAYLOG)
    const sanitizedQuery = dto.query === '*' ? '*' : sanitizeEsQueryString(dto.query)
    const result = await this.callExternalOrThrow('Graylog', () =>
      this.graylogService.searchEvents(config, {
        query: sanitizedQuery || '*',
        timerange: { type: 'relative', range: dto.timeRange },
        page: dto.page,
        per_page: dto.limit,
      })
    )
    this.logAction('searchGraylogLogs', tenantId, { query: dto.query, total: result.total })
    return {
      data: result.events,
      pagination: buildPaginationMeta(dto.page, dto.limit, result.total),
    }
  }

  async getGraylogEventDefinitions(tenantId: string): Promise<unknown[]> {
    const config = await this.getConfig(tenantId, ConnectorType.GRAYLOG)
    const definitions = await this.callExternalOrThrow('Graylog', () =>
      this.graylogService.getEventDefinitions(config)
    )
    this.logAction('getGraylogEventDefinitions', tenantId, { count: definitions.length })
    return definitions
  }

  // ── Grafana ───────────────────────────────────────────────────────

  async getGrafanaDashboards(
    tenantId: string,
    dto: GrafanaDashboardQueryDto
  ): Promise<PaginatedGrafanaDashboards> {
    const where = buildGrafanaDashboardWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManyGrafanaDashboards({
        where,
        orderBy: { [dto.sortBy ?? 'title']: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countGrafanaDashboards(where),
    ])
    this.logAction('getGrafanaDashboards', tenantId, { total })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async syncGrafanaDashboards(tenantId: string): Promise<{ synced: number }> {
    const config = await this.getConfig(tenantId, ConnectorType.GRAFANA)
    const dashboards = (await this.callExternalOrThrow('Grafana', () =>
      this.grafanaService.getDashboards(config)
    )) as Array<Record<string, unknown>>

    return this.runSyncJob(
      tenantId,
      ConnectorType.GRAFANA,
      dashboards,
      dashboard => {
        const { uid, create, update } = mapGrafanaDashboardUpsert(tenantId, dashboard)
        if (!uid) return Promise.reject(new Error('Missing uid'))
        return this.repository.upsertGrafanaDashboard({
          where: { tenantId_uid: { tenantId, uid } },
          create,
          update,
        })
      },
      'syncGrafanaDashboards'
    )
  }

  // ── InfluxDB ──────────────────────────────────────────────────────

  async queryInfluxDB(
    tenantId: string,
    dto: InfluxDBQueryDto
  ): Promise<{ data: string; bucket: string }> {
    const config = await this.getConfig(tenantId, ConnectorType.INFLUXDB)
    const flux = buildFluxQuery(dto.bucket, dto.range, dto.measurement, dto.limit)
    const result = await this.callExternalOrThrow('InfluxDB', () =>
      this.influxDBService.query(config, flux)
    )
    this.logAction('queryInfluxDB', tenantId, { bucket: dto.bucket })
    return { data: result, bucket: dto.bucket }
  }

  async getInfluxDBBuckets(tenantId: string): Promise<unknown[]> {
    const config = await this.getConfig(tenantId, ConnectorType.INFLUXDB)
    const buckets = await this.callExternalOrThrow('InfluxDB', () =>
      this.influxDBService.getBuckets(config)
    )
    this.logAction('getInfluxDBBuckets', tenantId, { count: buckets.length })
    return buckets
  }

  // ── MISP ──────────────────────────────────────────────────────────

  async searchMispEvents(
    tenantId: string,
    dto: MispEventQueryDto
  ): Promise<PaginatedUnknownResult> {
    const config = await this.getConfig(tenantId, ConnectorType.MISP)
    const searchParameters = buildMispSearchParameters(dto)

    const data = await this.callExternalOrThrow('MISP', () =>
      isMispAttributeSearch(dto)
        ? this.mispService.searchAttributes(config, searchParameters)
        : this.mispService.getEvents(config, dto.limit)
    )
    this.logAction('searchMispEvents', tenantId, { resultCount: data.length })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, data.length) }
  }

  async getMispEventDetail(tenantId: string, eventId: string): Promise<unknown> {
    const config = await this.getConfig(tenantId, ConnectorType.MISP)
    const event = await this.callExternalOrThrow('MISP', () =>
      this.mispService.getEvent(config, eventId)
    )
    this.logAction('getMispEventDetail', tenantId, { eventId })
    return event
  }

  // ── Velociraptor ──────────────────────────────────────────────────

  async getVelociraptorEndpoints(
    tenantId: string,
    dto: VelociraptorEndpointQueryDto
  ): Promise<PaginatedVelociraptorEndpoints> {
    const where = buildVelociraptorEndpointWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManyVelociraptorEndpoints({
        where,
        orderBy: { [dto.sortBy ?? 'hostname']: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countVelociraptorEndpoints(where),
    ])
    this.logAction('getVelociraptorEndpoints', tenantId, { total })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async getVelociraptorHunts(
    tenantId: string,
    dto: VelociraptorHuntQueryDto
  ): Promise<PaginatedVelociraptorHunts> {
    const where = buildVelociraptorHuntWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManyVelociraptorHunts({
        where,
        orderBy: { [dto.sortBy ?? 'createdAt']: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countVelociraptorHunts(where),
    ])
    this.logAction('getVelociraptorHunts', tenantId, { total })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async runVelociraptorVQL(
    tenantId: string,
    vql: string
  ): Promise<{ rows: unknown[]; columns: string[] }> {
    const config = await this.getConfig(tenantId, ConnectorType.VELOCIRAPTOR)
    const result = await this.callExternalOrThrow('Velociraptor', () =>
      this.velociraptorService.runVQL(config, vql)
    )
    this.logAction('runVelociraptorVQL', tenantId, {
      rowCount: result.rows.length,
      columnCount: result.columns.length,
    })
    return result
  }

  async syncVelociraptorMetadata(tenantId: string): Promise<{ endpoints: number; hunts: number }> {
    const config = await this.getConfig(tenantId, ConnectorType.VELOCIRAPTOR)
    const job = await this.createSyncJob(tenantId, ConnectorType.VELOCIRAPTOR)
    let totalSynced = 0
    let totalFailed = 0

    try {
      const endpointResult = await this.syncVelociraptorEndpoints(tenantId, config)
      const huntResult = await this.syncVelociraptorHunts(tenantId, config)

      totalSynced = endpointResult.synced + huntResult.synced
      totalFailed = endpointResult.failed + huntResult.failed
      await this.completeSyncJob(job.id, tenantId, totalSynced, totalFailed)

      this.logAction('syncVelociraptorMetadata', tenantId, {
        endpoints: endpointResult.synced,
        hunts: huntResult.synced,
        failed: totalFailed,
      })
      return { endpoints: endpointResult.synced, hunts: huntResult.synced }
    } catch (error) {
      await this.failSyncJob(job.id, tenantId, totalFailed, error)
      throw error
    }
  }

  // ── Logstash ──────────────────────────────────────────────────────

  async getLogstashLogs(
    tenantId: string,
    dto: LogstashLogQueryDto
  ): Promise<PaginatedLogstashLogs> {
    const where = buildLogstashLogWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManyLogstashLogs({
        where,
        orderBy: { [dto.sortBy ?? 'timestamp']: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countLogstashLogs(where),
    ])
    this.logAction('getLogstashLogs', tenantId, { total })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async syncLogstashLogs(tenantId: string): Promise<{ synced: number }> {
    const config = await this.getConfig(tenantId, ConnectorType.LOGSTASH)
    const pipelineStats = await this.callExternalOrThrow('Logstash', () =>
      this.logstashService.getPipelineStats(config)
    )

    const entries = Object.entries(pipelineStats.pipelines)
    return this.runSyncJob(
      tenantId,
      ConnectorType.LOGSTASH,
      entries,
      ([pipelineId, stats]) => {
        const data = mapLogstashPipelineEntry(tenantId, pipelineId, stats, LogLevel.INFO)
        return this.repository.createLogstashLog(data)
      },
      'syncLogstashLogs'
    )
  }

  // ── Shuffle ───────────────────────────────────────────────────────

  async getShuffleWorkflows(
    tenantId: string,
    dto: ShuffleWorkflowQueryDto
  ): Promise<PaginatedShuffleWorkflows> {
    const where = buildShuffleWorkflowWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManyShuffleWorkflows({
        where,
        orderBy: { [dto.sortBy ?? 'name']: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countShuffleWorkflows(where),
    ])
    this.logAction('getShuffleWorkflows', tenantId, { total })
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async syncShuffleWorkflows(tenantId: string): Promise<{ synced: number }> {
    const config = await this.getConfig(tenantId, ConnectorType.SHUFFLE)
    const workflows = (await this.callExternalOrThrow('Shuffle', () =>
      this.shuffleService.getWorkflows(config)
    )) as Array<Record<string, unknown>>

    return this.runSyncJob(
      tenantId,
      ConnectorType.SHUFFLE,
      workflows,
      workflow => {
        const { workflowId, create, update } = mapShuffleWorkflowUpsert(tenantId, workflow)
        if (!workflowId) return Promise.reject(new Error('Missing workflow id'))
        return this.repository.upsertShuffleWorkflow({
          where: { tenantId_workflowId: { tenantId, workflowId } },
          create,
          update,
        })
      },
      'syncShuffleWorkflows'
    )
  }

  // ── Sync Jobs ─────────────────────────────────────────────────────

  async getSyncJobs(tenantId: string, dto: SyncJobQueryDto): Promise<PaginatedSyncJobs> {
    const where = buildSyncJobWhere(tenantId, dto)
    const [data, total] = await Promise.all([
      this.repository.findManySyncJobs({
        where,
        orderBy: { startedAt: dto.sortOrder },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.repository.countSyncJobs(where),
    ])
    return { data, pagination: buildPaginationMeta(dto.page, dto.limit, total) }
  }

  async triggerSync(
    tenantId: string,
    connectorType: ConnectorType,
    initiatedBy: string
  ): Promise<{ jobId: string }> {
    await this.getConfig(tenantId, connectorType)
    const job = await this.createSyncJob(tenantId, connectorType, initiatedBy)

    this.executeSyncInBackground(tenantId, connectorType, job.id).catch(error => {
      this.logger.error(
        `Background sync failed for ${connectorType}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    })
    this.logAction('triggerSync', tenantId, { connectorType, jobId: job.id })
    return { jobId: job.id }
  }

  // ── Private: External Call Wrapper ────────────────────────────────

  private async callExternalOrThrow<T>(serviceName: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to ${serviceName}: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }
  }

  // ── Private: Sync Job Pipeline ────────────────────────────────────

  private async runSyncJob<T>(
    tenantId: string,
    connectorType: ConnectorType,
    items: T[],
    processFunction: (item: T) => Promise<unknown>,
    actionName: string
  ): Promise<{ synced: number }> {
    const job = await this.createSyncJob(tenantId, connectorType)
    try {
      const results = await processInBatches(items, 50, processFunction)
      const { synced, failed } = countBatchResults(results)
      await this.completeSyncJob(job.id, tenantId, synced, failed)
      this.logAction(actionName, tenantId, { synced, failed })
      return { synced }
    } catch (error) {
      await this.failSyncJob(job.id, tenantId, 0, error)
      throw error
    }
  }

  private async syncVelociraptorEndpoints(
    tenantId: string,
    config: Record<string, unknown>
  ): Promise<{ synced: number; failed: number }> {
    const clients = (await this.velociraptorService.getClients(config)) as Array<
      Record<string, unknown>
    >
    const results = await processInBatches(clients, 50, client => {
      const { clientId, create, update } = mapVelociraptorEndpointUpsert(tenantId, client)
      if (!clientId) return Promise.reject(new Error('Missing client_id'))
      return this.repository.upsertVelociraptorEndpoint({
        where: { tenantId_clientId: { tenantId, clientId } },
        create,
        update,
      })
    })
    return countBatchResults(results)
  }

  private async syncVelociraptorHunts(
    tenantId: string,
    config: Record<string, unknown>
  ): Promise<{ synced: number; failed: number }> {
    const huntResult = await this.velociraptorService.runVQL(
      config,
      'SELECT hunt_id, hunt_description, state, artifacts, stats, create_time FROM hunts()'
    )
    const results = await processInBatches(huntResult.rows, 50, row => {
      const { huntId, create, update } = mapVelociraptorHuntUpsert(tenantId, row)
      if (!huntId) return Promise.reject(new Error('Missing hunt_id'))
      return this.repository.upsertVelociraptorHunt({
        where: { tenantId_huntId: { tenantId, huntId } },
        create,
        update,
      })
    })
    return countBatchResults(results)
  }

  // ── Private: Config & Job Helpers ─────────────────────────────────

  private async getConfig(tenantId: string, type: ConnectorType): Promise<Record<string, unknown>> {
    const config = await this.connectorsService.getDecryptedConfig(tenantId, type)
    if (!config) {
      throw new BusinessException(
        404,
        `Connector ${type} not configured or disabled`,
        'errors.explorer.connectorNotConfigured'
      )
    }
    return config
  }

  private async createSyncJob(
    tenantId: string,
    connectorType: ConnectorType,
    initiatedBy = 'system'
  ): Promise<ConnectorSyncJob> {
    return this.repository.createSyncJob({
      tenantId,
      connectorType,
      status: SyncJobStatus.RUNNING,
      initiatedBy,
      startedAt: new Date(),
    })
  }

  private async completeSyncJob(
    jobId: string,
    tenantId: string,
    recordsSynced: number,
    recordsFailed: number
  ): Promise<void> {
    const job = await this.repository.findSyncJobById(jobId)
    const durationMs = job ? Date.now() - job.startedAt.getTime() : null
    await this.repository.updateSyncJob(jobId, tenantId, {
      status: SyncJobStatus.COMPLETED,
      recordsSynced,
      recordsFailed,
      durationMs,
      completedAt: new Date(),
    })
  }

  private async failSyncJob(
    jobId: string,
    tenantId: string,
    recordsFailed: number,
    error: unknown
  ): Promise<void> {
    const job = await this.repository.findSyncJobById(jobId)
    const durationMs = job ? Date.now() - job.startedAt.getTime() : null
    await this.repository.updateSyncJob(jobId, tenantId, {
      status: SyncJobStatus.FAILED,
      recordsFailed,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      durationMs,
      completedAt: new Date(),
    })
  }

  private async executeSyncInBackground(
    tenantId: string,
    connectorType: ConnectorType,
    jobId: string
  ): Promise<void> {
    try {
      switch (connectorType) {
        case ConnectorType.GRAFANA: {
          await this.syncGrafanaDashboards(tenantId)
          break
        }
        case ConnectorType.VELOCIRAPTOR: {
          await this.syncVelociraptorMetadata(tenantId)
          break
        }
        case ConnectorType.SHUFFLE: {
          await this.syncShuffleWorkflows(tenantId)
          break
        }
        case ConnectorType.LOGSTASH: {
          await this.syncLogstashLogs(tenantId)
          break
        }
        default: {
          await this.failSyncJob(
            jobId,
            tenantId,
            0,
            new Error(`Sync not supported for ${connectorType}`)
          )
        }
      }
    } catch (error) {
      this.logger.error(
        `Sync job ${jobId} failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  // ── Private: Logging ──────────────────────────────────────────────

  private logAction(
    functionName: string,
    tenantId: string,
    metadata: Record<string, unknown>
  ): void {
    this.appLogger.info(`Explorer: ${functionName}`, {
      feature: AppLogFeature.DATA_EXPLORER,
      action: functionName,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: CLASS_NAME,
      functionName,
      metadata,
    })
  }
}
