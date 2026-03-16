import { Injectable, Logger } from '@nestjs/common'
import { SystemHealthRepository } from './system-health.repository'
import {
  buildHealthCheckListWhere,
  buildHealthCheckOrderBy,
  buildMetricListWhere,
  buildMetricOrderBy,
  buildHealthCheckRecord,
  buildMetricRecord,
  buildSystemHealthStats,
} from './system-health.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  HealthCheckRecord,
  PaginatedHealthChecks,
  PaginatedMetrics,
  SystemHealthStats,
} from './system-health.types'

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name)

  constructor(
    private readonly repository: SystemHealthRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST HEALTH CHECKS (paginated, tenant-scoped)                     */
  /* ---------------------------------------------------------------- */

  async listHealthChecks(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    serviceType?: string,
    status?: string
  ): Promise<PaginatedHealthChecks> {
    const where = buildHealthCheckListWhere(tenantId, serviceType, status)
    const orderBy = buildHealthCheckOrderBy(sortBy, sortOrder)

    const [healthChecks, total] = await Promise.all([
      this.repository.findManyHealthChecks({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.countHealthChecks(where),
    ])

    const data: HealthCheckRecord[] = healthChecks.map(buildHealthCheckRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET LATEST HEALTH CHECKS                                          */
  /* ---------------------------------------------------------------- */

  async getLatestHealthChecks(tenantId: string): Promise<HealthCheckRecord[]> {
    const healthChecks = await this.repository.findLatestHealthChecks(tenantId)

    return healthChecks.map(buildHealthCheckRecord)
  }

  /* ---------------------------------------------------------------- */
  /* LIST METRICS (paginated, tenant-scoped)                           */
  /* ---------------------------------------------------------------- */

  async listMetrics(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    metricType?: string,
    metricName?: string
  ): Promise<PaginatedMetrics> {
    const where = buildMetricListWhere(tenantId, metricType, metricName)
    const orderBy = buildMetricOrderBy(sortBy, sortOrder)

    const [metrics, total] = await Promise.all([
      this.repository.findManyMetrics({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.countMetrics(where),
    ])

    const data = metrics.map(buildMetricRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getSystemHealthStats(tenantId: string): Promise<SystemHealthStats> {
    const latestChecks = await this.getLatestHealthChecks(tenantId)

    this.appLogger.info('System health stats retrieved', {
      feature: AppLogFeature.SYSTEM_HEALTH,
      action: 'getSystemHealthStats',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'SystemHealthService',
      functionName: 'getSystemHealthStats',
      metadata: {
        totalServices: latestChecks.length,
      },
    })

    return buildSystemHealthStats(latestChecks)
  }
}
