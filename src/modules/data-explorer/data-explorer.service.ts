import { Injectable, Logger } from '@nestjs/common'
import { DataExplorerRepository } from './data-explorer.repository'
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

const CLASS_NAME = 'DataExplorerService'

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

    const summaryMap = new Map<string, { count: number; connectors: string[] }>([
      ['running', { count: 0, connectors: [] }],
      ['completed', { count: 0, connectors: [] }],
      ['failed', { count: 0, connectors: [] }],
    ])
    for (const group of syncSummary) {
      const entry = summaryMap.get(group.status)
      if (entry) {
        entry.count += group._count
        if (!entry.connectors.includes(group.connectorType)) {
          entry.connectors.push(group.connectorType)
        }
      }
    }

    this.appLogger.info('Explorer overview fetched', {
      feature: AppLogFeature.DATA_EXPLORER,
      action: 'getOverview',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: CLASS_NAME,
      functionName: 'getOverview',
    })

    return {
      connectors: connectors.map(c => ({
        type: c.type,
        enabled: c.enabled,
        configured: c.lastTestOk === true,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      })),
      syncJobsSummary: {
        running: summaryMap.get('running') ?? { count: 0, connectors: [] },
        completed: summaryMap.get('completed') ?? { count: 0, connectors: [] },
        failed: summaryMap.get('failed') ?? { count: 0, connectors: [] },
      },
    }
  }

  // ── Graylog (Live Fetch) ───────────────────────────────────────────

  async searchGraylogLogs(
    tenantId: string,
    dto: GraylogSearchDto
  ): Promise<PaginatedUnknownResult> {
    const config = await this.getConfig(tenantId, ConnectorType.GRAYLOG)

    let result: { events: unknown[]; total: number }
    try {
      result = await this.graylogService.searchEvents(config, {
        query: dto.query,
        timerange: { type: 'relative', range: dto.timeRange },
        page: dto.page,
        per_page: dto.limit,
      })
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Graylog: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('searchGraylogLogs', tenantId, { query: dto.query, total: result.total })

    return {
      data: result.events,
      pagination: buildPaginationMeta(dto.page, dto.limit, result.total),
    }
  }

  async getGraylogEventDefinitions(tenantId: string): Promise<unknown[]> {
    const config = await this.getConfig(tenantId, ConnectorType.GRAYLOG)

    let definitions: unknown[]
    try {
      definitions = await this.graylogService.getEventDefinitions(config)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Graylog: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('getGraylogEventDefinitions', tenantId, { count: definitions.length })
    return definitions
  }

  // ── Grafana (Metadata Sync + Live Drilldown) ──────────────────────

  async getGrafanaDashboards(
    tenantId: string,
    dto: GrafanaDashboardQueryDto
  ): Promise<PaginatedGrafanaDashboards> {
    // Read from synced metadata in DB
    const where: Record<string, unknown> = { tenantId }
    if (dto.search) {
      where['title'] = { contains: dto.search, mode: 'insensitive' }
    }
    if (dto.tag) {
      where['tags'] = { has: dto.tag }
    }
    if (dto.folder) {
      where['folderTitle'] = { contains: dto.folder, mode: 'insensitive' }
    }
    if (dto.starred !== undefined) {
      where['isStarred'] = dto.starred
    }

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

    let dashboards: Array<Record<string, unknown>>
    try {
      dashboards = (await this.grafanaService.getDashboards(config)) as Array<
        Record<string, unknown>
      >
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Grafana: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.syncFailed'
      )
    }

    const job = await this.createSyncJob(tenantId, ConnectorType.GRAFANA)
    let synced = 0
    let recordsFailed = 0

    try {
      const allResults = await processInBatches(dashboards, 50, dashboard => {
        const uid = String(dashboard['uid'] ?? '')
        if (!uid) {
          return Promise.reject(new Error('Missing uid'))
        }
        return this.repository.upsertGrafanaDashboard({
          where: { tenantId_uid: { tenantId, uid } },
          create: {
            tenantId,
            uid,
            title: String(dashboard['title'] ?? 'Untitled'),
            folderTitle: dashboard['folderTitle'] ? String(dashboard['folderTitle']) : null,
            url: String(dashboard['url'] ?? ''),
            tags: Array.isArray(dashboard['tags']) ? (dashboard['tags'] as string[]) : [],
            type: String(dashboard['type'] ?? 'dash-db'),
            isStarred: Boolean(dashboard['isStarred']),
            syncedAt: new Date(),
          },
          update: {
            title: String(dashboard['title'] ?? 'Untitled'),
            folderTitle: dashboard['folderTitle'] ? String(dashboard['folderTitle']) : null,
            url: String(dashboard['url'] ?? ''),
            tags: Array.isArray(dashboard['tags']) ? (dashboard['tags'] as string[]) : [],
            type: String(dashboard['type'] ?? 'dash-db'),
            isStarred: Boolean(dashboard['isStarred']),
            syncedAt: new Date(),
          },
        })
      })
      for (const result of allResults) {
        if (result.status === 'fulfilled') {
          synced++
        } else {
          recordsFailed++
        }
      }

      await this.completeSyncJob(job.id, synced, recordsFailed)
    } catch (error) {
      await this.failSyncJob(job.id, recordsFailed, error)
      throw error
    }

    this.logAction('syncGrafanaDashboards', tenantId, { synced, failed: recordsFailed })
    return { synced }
  }

  // ── InfluxDB (Live Query) ──────────────────────────────────────────

  async queryInfluxDB(
    tenantId: string,
    dto: InfluxDBQueryDto
  ): Promise<{ data: string; bucket: string }> {
    const config = await this.getConfig(tenantId, ConnectorType.INFLUXDB)

    // Build a safe Flux query from user params
    const flux = [
      `from(bucket: "${this.sanitizeFluxString(dto.bucket)}")`,
      `  |> range(start: ${this.sanitizeFluxDuration(dto.range)})`,
      dto.measurement
        ? `  |> filter(fn: (r) => r._measurement == "${this.sanitizeFluxString(dto.measurement)}")`
        : '',
      `  |> limit(n: ${dto.limit})`,
    ]
      .filter(Boolean)
      .join('\n')

    let result: string
    try {
      result = await this.influxDBService.query(config, flux)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to InfluxDB: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('queryInfluxDB', tenantId, { bucket: dto.bucket })
    return { data: result, bucket: dto.bucket }
  }

  async getInfluxDBBuckets(tenantId: string): Promise<unknown[]> {
    const config = await this.getConfig(tenantId, ConnectorType.INFLUXDB)

    let buckets: unknown[]
    try {
      buckets = await this.influxDBService.getBuckets(config)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to InfluxDB: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('getInfluxDBBuckets', tenantId, { count: buckets.length })
    return buckets
  }

  // ── MISP (Full Metadata Sync) ──────────────────────────────────────

  async searchMispEvents(
    tenantId: string,
    dto: MispEventQueryDto
  ): Promise<PaginatedUnknownResult> {
    const config = await this.getConfig(tenantId, ConnectorType.MISP)

    // Build search params for MISP API
    const searchParameters: Record<string, unknown> = {}
    if (dto.value) {
      searchParameters['value'] = dto.value
    }
    if (dto.type) {
      searchParameters['type'] = dto.type
    }
    if (dto.category) {
      searchParameters['category'] = dto.category
    }

    // If searching attributes, use searchAttributes; otherwise list events
    let data: unknown[]
    try {
      data = await (dto.value || dto.type || dto.category
        ? this.mispService.searchAttributes(config, searchParameters)
        : this.mispService.getEvents(config, dto.limit))
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to MISP: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('searchMispEvents', tenantId, { resultCount: data.length })

    return {
      data,
      pagination: buildPaginationMeta(dto.page, dto.limit, data.length),
    }
  }

  async getMispEventDetail(tenantId: string, eventId: string): Promise<unknown> {
    const config = await this.getConfig(tenantId, ConnectorType.MISP)

    let event: unknown
    try {
      event = await this.mispService.getEvent(config, eventId)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to MISP: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('getMispEventDetail', tenantId, { eventId })
    return event
  }

  // ── Velociraptor (Metadata Sync + Live Drilldown) ──────────────────

  async getVelociraptorEndpoints(
    tenantId: string,
    dto: VelociraptorEndpointQueryDto
  ): Promise<PaginatedVelociraptorEndpoints> {
    const where: Record<string, unknown> = { tenantId }
    if (dto.search) {
      where['hostname'] = { contains: dto.search, mode: 'insensitive' }
    }
    if (dto.os) {
      where['os'] = { contains: dto.os, mode: 'insensitive' }
    }
    if (dto.label) {
      where['labels'] = { has: dto.label }
    }

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
    const where: Record<string, unknown> = { tenantId }
    if (dto.search) {
      where['description'] = { contains: dto.search, mode: 'insensitive' }
    }
    if (dto.state) {
      where['state'] = dto.state
    }

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

    let result: { rows: unknown[]; columns: string[] }
    try {
      result = await this.velociraptorService.runVQL(config, vql)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Velociraptor: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.connectorUnavailable'
      )
    }

    this.logAction('runVelociraptorVQL', tenantId, {
      rowCount: result.rows.length,
      columnCount: result.columns.length,
    })
    return result
  }

  async syncVelociraptorMetadata(tenantId: string): Promise<{ endpoints: number; hunts: number }> {
    const config = await this.getConfig(tenantId, ConnectorType.VELOCIRAPTOR)
    const job = await this.createSyncJob(tenantId, ConnectorType.VELOCIRAPTOR)

    let endpointsSynced = 0
    let huntsSynced = 0
    let recordsFailed = 0

    try {
      // Sync endpoints
      const clients = (await this.velociraptorService.getClients(config)) as Array<
        Record<string, unknown>
      >
      const endpointResults = await processInBatches(clients, 50, client => {
        const clientId = String(client['client_id'] ?? '')
        if (!clientId) {
          return Promise.reject(new Error('Missing client_id'))
        }
        return this.repository.upsertVelociraptorEndpoint({
          where: { tenantId_clientId: { tenantId, clientId } },
          create: {
            tenantId,
            clientId,
            hostname: String(
              (client['os_info'] as Record<string, unknown> | undefined)?.['fqdn'] ??
                client['client_id'] ??
                'unknown'
            ),
            os: String(
              (client['os_info'] as Record<string, unknown> | undefined)?.['system'] ?? 'unknown'
            ),
            labels: Array.isArray(client['labels']) ? (client['labels'] as string[]) : [],
            ipAddress: String(client['last_ip'] ?? ''),
            lastSeenAt: client['last_seen_at']
              ? new Date(Number(client['last_seen_at']) / 1000)
              : new Date(),
            syncedAt: new Date(),
          },
          update: {
            hostname: String(
              (client['os_info'] as Record<string, unknown> | undefined)?.['fqdn'] ??
                client['client_id'] ??
                'unknown'
            ),
            os: String(
              (client['os_info'] as Record<string, unknown> | undefined)?.['system'] ?? 'unknown'
            ),
            labels: Array.isArray(client['labels']) ? (client['labels'] as string[]) : [],
            ipAddress: String(client['last_ip'] ?? ''),
            lastSeenAt: client['last_seen_at']
              ? new Date(Number(client['last_seen_at']) / 1000)
              : new Date(),
            syncedAt: new Date(),
          },
        })
      })
      for (const result of endpointResults) {
        if (result.status === 'fulfilled') {
          endpointsSynced++
        } else {
          recordsFailed++
        }
      }

      // Sync hunts via VQL
      const huntResult_ult = await this.velociraptorService.runVQL(
        config,
        'SELECT hunt_id, hunt_description, state, artifacts, stats, create_time FROM hunts()'
      )
      const huntResults = await processInBatches(huntResult_ult.rows, 50, row => {
        const hunt = row as Record<string, unknown>
        const huntId = String(hunt['hunt_id'] ?? '')
        if (!huntId) {
          return Promise.reject(new Error('Missing hunt_id'))
        }
        const stats = (hunt['stats'] ?? {}) as Record<string, unknown>
        return this.repository.upsertVelociraptorHunt({
          where: { tenantId_huntId: { tenantId, huntId } },
          create: {
            tenantId,
            huntId,
            description: String(hunt['hunt_description'] ?? ''),
            state: String(hunt['state'] ?? 'PAUSED'),
            artifacts: Array.isArray(hunt['artifacts']) ? (hunt['artifacts'] as string[]) : [],
            totalClients: Number(stats['total_clients_scheduled'] ?? 0),
            finishedClients: Number(stats['total_clients_with_results'] ?? 0),
            createdAt: hunt['create_time']
              ? new Date(Number(hunt['create_time']) / 1000)
              : new Date(),
            syncedAt: new Date(),
          },
          update: {
            description: String(hunt['hunt_description'] ?? ''),
            state: String(hunt['state'] ?? 'PAUSED'),
            artifacts: Array.isArray(hunt['artifacts']) ? (hunt['artifacts'] as string[]) : [],
            totalClients: Number(stats['total_clients_scheduled'] ?? 0),
            finishedClients: Number(stats['total_clients_with_results'] ?? 0),
            syncedAt: new Date(),
          },
        })
      })
      for (const huntResult of huntResults) {
        if (huntResult.status === 'fulfilled') {
          huntsSynced++
        } else {
          recordsFailed++
        }
      }

      await this.completeSyncJob(job.id, endpointsSynced + huntsSynced, recordsFailed)
    } catch (error) {
      await this.failSyncJob(job.id, recordsFailed, error)
      throw error
    }

    this.logAction('syncVelociraptorMetadata', tenantId, {
      endpoints: endpointsSynced,
      hunts: huntsSynced,
      failed: recordsFailed,
    })
    return { endpoints: endpointsSynced, hunts: huntsSynced }
  }

  // ── Logstash (Pipeline Logs — DB Sync) ─────────────────────────────

  async getLogstashLogs(
    tenantId: string,
    dto: LogstashLogQueryDto
  ): Promise<PaginatedLogstashLogs> {
    const where: Record<string, unknown> = { tenantId }
    if (dto.search) {
      where['message'] = { contains: dto.search, mode: 'insensitive' }
    }
    if (dto.level) {
      where['level'] = dto.level
    }
    if (dto.pipelineId) {
      where['pipelineId'] = { contains: dto.pipelineId, mode: 'insensitive' }
    }

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

    let pipelineStats: { pipelines: Record<string, unknown> }
    try {
      pipelineStats = await this.logstashService.getPipelineStats(config)
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Logstash: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.syncFailed'
      )
    }

    const job = await this.createSyncJob(tenantId, ConnectorType.LOGSTASH)
    let synced = 0
    let recordsFailed = 0

    try {
      const pipelineEntries = Object.entries(pipelineStats.pipelines)
      const pipelineResults = await processInBatches(
        pipelineEntries,
        50,
        ([pipelineId, stats]: [string, unknown]) => {
          const pipelineStat = stats as Record<string, unknown>
          const events = (pipelineStat['events'] ?? {}) as Record<string, unknown>
          return this.repository.createLogstashLog({
            tenantId,
            pipelineId,
            timestamp: new Date(),
            level: LogLevel.INFO,
            message: `Pipeline ${pipelineId} stats snapshot`,
            source: pipelineId,
            eventsIn: Number(events['in'] ?? 0),
            eventsOut: Number(events['out'] ?? 0),
            eventsFiltered: Number(events['filtered'] ?? 0),
            durationMs: Number(events['duration_in_millis'] ?? 0),
            metadata: JSON.parse(JSON.stringify(pipelineStat)),
            syncedAt: new Date(),
          })
        }
      )
      for (const result of pipelineResults) {
        if (result.status === 'fulfilled') {
          synced++
        } else {
          recordsFailed++
        }
      }

      await this.completeSyncJob(job.id, synced, recordsFailed)
    } catch (error) {
      await this.failSyncJob(job.id, recordsFailed, error)
      throw error
    }

    this.logAction('syncLogstashLogs', tenantId, { synced, failed: recordsFailed })
    return { synced }
  }

  // ── Shuffle (Metadata Sync + Live Status) ──────────────────────────

  async getShuffleWorkflows(
    tenantId: string,
    dto: ShuffleWorkflowQueryDto
  ): Promise<PaginatedShuffleWorkflows> {
    const where: Record<string, unknown> = { tenantId }
    if (dto.search) {
      where['name'] = { contains: dto.search, mode: 'insensitive' }
    }
    if (dto.status === 'valid') {
      where['isValid'] = true
    } else if (dto.status === 'invalid') {
      where['isValid'] = false
    }

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

    let workflows: Array<Record<string, unknown>>
    try {
      workflows = (await this.shuffleService.getWorkflows(config)) as Array<Record<string, unknown>>
    } catch (error) {
      throw new BusinessException(
        502,
        `Failed to connect to Shuffle: ${error instanceof Error ? error.message : 'unknown'}`,
        'errors.explorer.syncFailed'
      )
    }

    const job = await this.createSyncJob(tenantId, ConnectorType.SHUFFLE)
    let synced = 0
    let recordsFailed = 0

    try {
      const workflowResults = await processInBatches(workflows, 50, workflow => {
        const workflowId = String(workflow['id'] ?? '')
        if (!workflowId) {
          return Promise.reject(new Error('Missing workflow id'))
        }
        return this.repository.upsertShuffleWorkflow({
          where: { tenantId_workflowId: { tenantId, workflowId } },
          create: {
            tenantId,
            workflowId,
            name: String(workflow['name'] ?? 'Unnamed'),
            description: workflow['description'] ? String(workflow['description']) : null,
            isValid: Boolean(workflow['is_valid']),
            triggerCount: Number((workflow['triggers'] as unknown[] | undefined)?.length ?? 0),
            tags: Array.isArray(workflow['tags']) ? (workflow['tags'] as string[]) : [],
            syncedAt: new Date(),
          },
          update: {
            name: String(workflow['name'] ?? 'Unnamed'),
            description: workflow['description'] ? String(workflow['description']) : null,
            isValid: Boolean(workflow['is_valid']),
            triggerCount: Number((workflow['triggers'] as unknown[] | undefined)?.length ?? 0),
            tags: Array.isArray(workflow['tags']) ? (workflow['tags'] as string[]) : [],
            syncedAt: new Date(),
          },
        })
      })
      for (const result of workflowResults) {
        if (result.status === 'fulfilled') {
          synced++
        } else {
          recordsFailed++
        }
      }

      await this.completeSyncJob(job.id, synced, recordsFailed)
    } catch (error) {
      await this.failSyncJob(job.id, recordsFailed, error)
      throw error
    }

    this.logAction('syncShuffleWorkflows', tenantId, { synced, failed: recordsFailed })
    return { synced }
  }

  // ── Sync Jobs ──────────────────────────────────────────────────────

  async getSyncJobs(tenantId: string, dto: SyncJobQueryDto): Promise<PaginatedSyncJobs> {
    const where: Record<string, unknown> = { tenantId }
    if (dto.connectorType) {
      where['connectorType'] = dto.connectorType
    }
    if (dto.status) {
      where['status'] = dto.status
    }

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
    // Validate connector is enabled
    await this.getConfig(tenantId, connectorType)

    const job = await this.createSyncJob(tenantId, connectorType, initiatedBy)

    // Run sync in background — don't await
    this.executeSyncInBackground(tenantId, connectorType, job.id).catch(error => {
      this.logger.error(
        `Background sync failed for ${connectorType}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    })

    this.logAction('triggerSync', tenantId, { connectorType, jobId: job.id })
    return { jobId: job.id }
  }

  // ── Private Helpers ────────────────────────────────────────────────

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
    recordsSynced: number,
    recordsFailed: number
  ): Promise<void> {
    const job = await this.repository.findSyncJobById(jobId)
    const durationMs = job ? Date.now() - job.startedAt.getTime() : null

    await this.repository.updateSyncJob(jobId, {
      status: SyncJobStatus.COMPLETED,
      recordsSynced,
      recordsFailed,
      durationMs,
      completedAt: new Date(),
    })
  }

  private async failSyncJob(jobId: string, recordsFailed: number, error: unknown): Promise<void> {
    const job = await this.repository.findSyncJobById(jobId)
    const durationMs = job ? Date.now() - job.startedAt.getTime() : null

    await this.repository.updateSyncJob(jobId, {
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
        case ConnectorType.GRAFANA:
          await this.syncGrafanaDashboards(tenantId)
          break
        case ConnectorType.VELOCIRAPTOR:
          await this.syncVelociraptorMetadata(tenantId)
          break
        case ConnectorType.SHUFFLE:
          await this.syncShuffleWorkflows(tenantId)
          break
        case ConnectorType.LOGSTASH:
          await this.syncLogstashLogs(tenantId)
          break
        default:
          await this.failSyncJob(jobId, 0, new Error(`Sync not supported for ${connectorType}`))
      }
    } catch (error) {
      this.logger.error(
        `Sync job ${jobId} failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

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

  /** Sanitize a string value for Flux query injection prevention. */
  private sanitizeFluxString(value: string): string {
    return value.replaceAll('"', '\\"').replaceAll('\\', '\\\\')
  }

  /** Validate a Flux duration string (e.g. -1h, -24h, -7d). */
  private sanitizeFluxDuration(value: string): string {
    // Only allow safe duration patterns
    if (/^-?\d+[smhdwy]$/.test(value)) {
      return value
    }
    return '-1h' // fallback
  }
}
