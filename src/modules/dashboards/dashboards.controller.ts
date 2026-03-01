import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { DashboardsService } from './dashboards.service';

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  @Get('summary')
  async getSummary(@TenantId() tenantId: string) {
    return this.dashboardsService.getSummary(tenantId);
  }

  @Get('alert-trend')
  async getAlertTrend(
    @TenantId() tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.dashboardsService.getAlertTrend(tenantId, Number(days) || 7);
  }

  @Get('severity-distribution')
  async getSeverityDistribution(@TenantId() tenantId: string) {
    return this.dashboardsService.getSeverityDistribution(tenantId);
  }

  @Get('mitre-top-techniques')
  async getMitreTopTechniques(@TenantId() tenantId: string) {
    return this.dashboardsService.getMitreTopTechniques(tenantId);
  }

  @Get('top-targeted-assets')
  async getTopTargetedAssets(@TenantId() tenantId: string) {
    return this.dashboardsService.getTopTargetedAssets(tenantId);
  }

  @Get('pipeline-health')
  async getPipelineHealth(@TenantId() tenantId: string) {
    return this.dashboardsService.getPipelineHealth(tenantId);
  }
}
