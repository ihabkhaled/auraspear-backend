import { Controller, Get, Post, Query, Body, Param } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { DataExplorerService } from './data-explorer.service'
import {
  GraylogSearchSchema,
  GrafanaDashboardQuerySchema,
  InfluxDBQuerySchema,
  MispEventQuerySchema,
  VelociraptorEndpointQuerySchema,
  VelociraptorHuntQuerySchema,
  VelociraptorVQLSchema,
  LogstashLogQuerySchema,
  ShuffleWorkflowQuerySchema,
  SyncJobQuerySchema,
  TriggerSyncSchema,
} from './dto/explorer-query.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  ExplorerOverview,
  InfluxDBQueryResult,
  PaginatedGrafanaDashboards,
  PaginatedLogstashLogs,
  PaginatedShuffleWorkflows,
  PaginatedSyncJobs,
  PaginatedUnknownResult,
  PaginatedVelociraptorEndpoints,
  PaginatedVelociraptorHunts,
  SyncResult,
  TriggerSyncResult,
  VelociraptorSyncResult,
  VQLResult,
} from './data-explorer.types'
import type {
  GraylogSearchDto,
  GrafanaDashboardQueryDto,
  InfluxDBQueryDto,
  MispEventQueryDto,
  VelociraptorEndpointQueryDto,
  VelociraptorHuntQueryDto,
  VelociraptorVQLDto,
  LogstashLogQueryDto,
  ShuffleWorkflowQueryDto,
  SyncJobQueryDto,
  TriggerSyncDto,
} from './dto/explorer-query.dto'

@ApiTags('data-explorer')
@ApiBearerAuth()
@Controller('data-explorer')
export class DataExplorerController {
  constructor(private readonly explorerService: DataExplorerService) {}

  // ── Overview ───────────────────────────────────────────────────────

  @Get('overview')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getOverview(@TenantId() tenantId: string): Promise<ExplorerOverview> {
    return this.explorerService.getOverview(tenantId)
  }

  // ── Graylog (Logs) ────────────────────────────────────────────────

  @Get('graylog/logs')
  @Roles(UserRole.SOC_ANALYST_L1)
  async searchGraylogLogs(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(GraylogSearchSchema)) query: GraylogSearchDto
  ): Promise<PaginatedUnknownResult> {
    return this.explorerService.searchGraylogLogs(tenantId, query)
  }

  @Get('graylog/event-definitions')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getGraylogEventDefinitions(@TenantId() tenantId: string): Promise<unknown[]> {
    return this.explorerService.getGraylogEventDefinitions(tenantId)
  }

  // ── Grafana (Dashboards) ──────────────────────────────────────────

  @Get('grafana/dashboards')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getGrafanaDashboards(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(GrafanaDashboardQuerySchema)) query: GrafanaDashboardQueryDto
  ): Promise<PaginatedGrafanaDashboards> {
    return this.explorerService.getGrafanaDashboards(tenantId, query)
  }

  @Post('grafana/sync')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async syncGrafanaDashboards(@TenantId() tenantId: string): Promise<SyncResult> {
    return this.explorerService.syncGrafanaDashboards(tenantId)
  }

  // ── InfluxDB (Metrics) ────────────────────────────────────────────

  @Get('influxdb/query')
  @Roles(UserRole.SOC_ANALYST_L1)
  async queryInfluxDB(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(InfluxDBQuerySchema)) query: InfluxDBQueryDto
  ): Promise<InfluxDBQueryResult> {
    return this.explorerService.queryInfluxDB(tenantId, query)
  }

  @Get('influxdb/buckets')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getInfluxDBBuckets(@TenantId() tenantId: string): Promise<unknown[]> {
    return this.explorerService.getInfluxDBBuckets(tenantId)
  }

  // ── MISP (Threat Intel) ───────────────────────────────────────────

  @Get('misp/events')
  @Roles(UserRole.SOC_ANALYST_L1)
  async searchMispEvents(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(MispEventQuerySchema)) query: MispEventQueryDto
  ): Promise<PaginatedUnknownResult> {
    return this.explorerService.searchMispEvents(tenantId, query)
  }

  @Get('misp/events/:eventId')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getMispEventDetail(
    @TenantId() tenantId: string,
    @Param('eventId') eventId: string
  ): Promise<unknown> {
    return this.explorerService.getMispEventDetail(tenantId, eventId)
  }

  // ── Velociraptor (Endpoints & Hunts) ──────────────────────────────

  @Get('velociraptor/endpoints')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getVelociraptorEndpoints(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(VelociraptorEndpointQuerySchema))
    query: VelociraptorEndpointQueryDto
  ): Promise<PaginatedVelociraptorEndpoints> {
    return this.explorerService.getVelociraptorEndpoints(tenantId, query)
  }

  @Get('velociraptor/hunts')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getVelociraptorHunts(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(VelociraptorHuntQuerySchema)) query: VelociraptorHuntQueryDto
  ): Promise<PaginatedVelociraptorHunts> {
    return this.explorerService.getVelociraptorHunts(tenantId, query)
  }

  @Post('velociraptor/vql')
  @Roles(UserRole.SOC_ANALYST_L2)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async runVelociraptorVQL(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(VelociraptorVQLSchema)) body: VelociraptorVQLDto
  ): Promise<VQLResult> {
    return this.explorerService.runVelociraptorVQL(tenantId, body.vql)
  }

  @Post('velociraptor/sync')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async syncVelociraptorMetadata(@TenantId() tenantId: string): Promise<VelociraptorSyncResult> {
    return this.explorerService.syncVelociraptorMetadata(tenantId)
  }

  // ── Logstash (Pipeline Logs) ─────────────────────────────────────

  @Get('logstash/logs')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getLogstashLogs(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(LogstashLogQuerySchema)) query: LogstashLogQueryDto
  ): Promise<PaginatedLogstashLogs> {
    return this.explorerService.getLogstashLogs(tenantId, query)
  }

  @Post('logstash/sync')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async syncLogstashLogs(@TenantId() tenantId: string): Promise<SyncResult> {
    return this.explorerService.syncLogstashLogs(tenantId)
  }

  // ── Shuffle (Automation) ──────────────────────────────────────────

  @Get('shuffle/workflows')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getShuffleWorkflows(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(ShuffleWorkflowQuerySchema)) query: ShuffleWorkflowQueryDto
  ): Promise<PaginatedShuffleWorkflows> {
    return this.explorerService.getShuffleWorkflows(tenantId, query)
  }

  @Post('shuffle/sync')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async syncShuffleWorkflows(@TenantId() tenantId: string): Promise<SyncResult> {
    return this.explorerService.syncShuffleWorkflows(tenantId)
  }

  // ── Sync Jobs ─────────────────────────────────────────────────────

  @Get('sync-jobs')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getSyncJobs(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(SyncJobQuerySchema)) query: SyncJobQueryDto
  ): Promise<PaginatedSyncJobs> {
    return this.explorerService.getSyncJobs(tenantId, query)
  }

  @Post('sync-jobs/trigger')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async triggerSync(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(TriggerSyncSchema)) body: TriggerSyncDto,
    @CurrentUser('email') email: string
  ): Promise<TriggerSyncResult> {
    return this.explorerService.triggerSync(tenantId, body.connectorType, email)
  }
}
