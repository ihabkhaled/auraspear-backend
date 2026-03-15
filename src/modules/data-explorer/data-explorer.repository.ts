import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class DataExplorerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* Connector config */

  async findConnectorConfigs(tenantId: string) {
    return this.prisma.connectorConfig.findMany({
      where: { tenantId },
      select: {
        type: true,
        enabled: true,
        lastTestOk: true,
        lastSyncAt: true,
      },
      orderBy: { type: 'asc' },
    })
  }

  /* Sync jobs */

  async groupBySyncJobStatus(tenantId: string) {
    return this.prisma.connectorSyncJob.groupBy({
      by: ['status', 'connectorType'],
      where: { tenantId },
      _count: true,
    })
  }

  async createSyncJob(data: Prisma.ConnectorSyncJobUncheckedCreateInput) {
    return this.prisma.connectorSyncJob.create({ data })
  }

  async findSyncJobById(id: string) {
    return this.prisma.connectorSyncJob.findUnique({ where: { id } })
  }

  async updateSyncJob(id: string, data: Prisma.ConnectorSyncJobUncheckedUpdateInput) {
    return this.prisma.connectorSyncJob.update({
      where: { id },
      data,
    })
  }

  async findManySyncJobs(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.connectorSyncJob.findMany(params)
  }

  async countSyncJobs(where: Record<string, unknown>) {
    return this.prisma.connectorSyncJob.count({ where })
  }

  /* Grafana */

  async findManyGrafanaDashboards(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.grafanaDashboard.findMany(params)
  }

  async countGrafanaDashboards(where: Record<string, unknown>) {
    return this.prisma.grafanaDashboard.count({ where })
  }

  async upsertGrafanaDashboard(params: Prisma.GrafanaDashboardUpsertArgs) {
    return this.prisma.grafanaDashboard.upsert(params)
  }

  /* Velociraptor */

  async findManyVelociraptorEndpoints(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.velociraptorEndpoint.findMany(params)
  }

  async countVelociraptorEndpoints(where: Record<string, unknown>) {
    return this.prisma.velociraptorEndpoint.count({ where })
  }

  async upsertVelociraptorEndpoint(params: Prisma.VelociraptorEndpointUpsertArgs) {
    return this.prisma.velociraptorEndpoint.upsert(params)
  }

  async findManyVelociraptorHunts(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.velociraptorHunt.findMany(params)
  }

  async countVelociraptorHunts(where: Record<string, unknown>) {
    return this.prisma.velociraptorHunt.count({ where })
  }

  async upsertVelociraptorHunt(params: Prisma.VelociraptorHuntUpsertArgs) {
    return this.prisma.velociraptorHunt.upsert(params)
  }

  /* Logstash */

  async findManyLogstashLogs(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.logstashPipelineLog.findMany(params)
  }

  async countLogstashLogs(where: Record<string, unknown>) {
    return this.prisma.logstashPipelineLog.count({ where })
  }

  async createLogstashLog(data: Prisma.LogstashPipelineLogUncheckedCreateInput) {
    return this.prisma.logstashPipelineLog.create({ data })
  }

  /* Shuffle */

  async findManyShuffleWorkflows(params: {
    where: Record<string, unknown>
    orderBy: Record<string, string>
    skip: number
    take: number
  }) {
    return this.prisma.shuffleWorkflow.findMany(params)
  }

  async countShuffleWorkflows(where: Record<string, unknown>) {
    return this.prisma.shuffleWorkflow.count({ where })
  }

  async upsertShuffleWorkflow(params: Prisma.ShuffleWorkflowUpsertArgs) {
    return this.prisma.shuffleWorkflow.upsert(params)
  }
}
