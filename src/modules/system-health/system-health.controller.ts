import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ListHealthChecksQuerySchema } from './dto/list-health-checks-query.dto'
import { ListMetricsQuerySchema } from './dto/list-metrics-query.dto'
import { SystemHealthService } from './system-health.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import type {
  HealthCheckRecord,
  PaginatedHealthChecks,
  PaginatedMetrics,
  SystemHealthStats,
} from './system-health.types'

@Controller('system-health')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles(UserRole.SOC_ANALYST_L1)
export class SystemHealthController {
  constructor(private readonly systemHealthService: SystemHealthService) {}

  @Get()
  async getSystemHealthOverview(@TenantId() tenantId: string): Promise<SystemHealthStats> {
    return this.systemHealthService.getSystemHealthStats(tenantId)
  }

  @Get('checks')
  async listHealthChecks(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedHealthChecks> {
    const { page, limit, sortBy, sortOrder, serviceType, status } =
      ListHealthChecksQuerySchema.parse(rawQuery)
    return this.systemHealthService.listHealthChecks(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      serviceType,
      status
    )
  }

  @Get('checks/latest')
  async getLatestHealthChecks(@TenantId() tenantId: string): Promise<HealthCheckRecord[]> {
    return this.systemHealthService.getLatestHealthChecks(tenantId)
  }

  @Get('metrics')
  async listMetrics(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedMetrics> {
    const { page, limit, sortBy, sortOrder, metricType, metricName } =
      ListMetricsQuerySchema.parse(rawQuery)
    return this.systemHealthService.listMetrics(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      metricType,
      metricName
    )
  }

  @Get('stats')
  async getSystemHealthStats(@TenantId() tenantId: string): Promise<SystemHealthStats> {
    return this.systemHealthService.getSystemHealthStats(tenantId)
  }
}
