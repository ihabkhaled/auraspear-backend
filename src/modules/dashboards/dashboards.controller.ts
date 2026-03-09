import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { DashboardsService } from './dashboards.service'
import { AlertTrendQuerySchema } from './dto/dashboard-query.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

interface DashboardSummary {
  tenantId: string
  totalAlerts: number
  criticalAlerts: number
  openCases: number
  alertsLast24h: number
  resolvedLast24h: number
  meanTimeToRespond: string
  connectedSources: number
  totalAlertsTrend: number
  criticalAlertsTrend: number
  openCasesTrend: number
  mttrTrend: number
}

interface AlertTrendEntry {
  date: string
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

interface AlertTrend {
  tenantId: string
  days: number
  trend: AlertTrendEntry[]
}

interface SeverityDistributionEntry {
  severity: string
  count: number
  percentage: number
}

interface SeverityDistribution {
  tenantId: string
  distribution: SeverityDistributionEntry[]
}

interface MitreTopTechniques {
  tenantId: string
  techniques: Array<{ id: string; count: number }>
}

interface TopTargetedAsset {
  hostname: string
  alertCount: number
  criticalCount: number
  lastSeen: Date
}

interface TopTargetedAssets {
  tenantId: string
  assets: TopTargetedAsset[]
}

interface PipelineEntry {
  name: string
  type: string
  status: string
  lastChecked: Date | null
  lastError: string | null
}

interface PipelineHealth {
  tenantId: string
  pipelines: PipelineEntry[]
}

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  @Get('summary')
  async getSummary(@TenantId() tenantId: string): Promise<DashboardSummary> {
    return this.dashboardsService.getSummary(tenantId)
  }

  @Get('alert-trend')
  async getAlertTrend(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, unknown>
  ): Promise<AlertTrend> {
    const query = AlertTrendQuerySchema.parse(rawQuery)
    return this.dashboardsService.getAlertTrend(tenantId, query.days)
  }

  @Get('severity-distribution')
  async getSeverityDistribution(@TenantId() tenantId: string): Promise<SeverityDistribution> {
    return this.dashboardsService.getSeverityDistribution(tenantId)
  }

  @Get('mitre-top-techniques')
  async getMitreTopTechniques(@TenantId() tenantId: string): Promise<MitreTopTechniques> {
    return this.dashboardsService.getMitreTopTechniques(tenantId)
  }

  @Get('top-targeted-assets')
  async getTopTargetedAssets(@TenantId() tenantId: string): Promise<TopTargetedAssets> {
    return this.dashboardsService.getTopTargetedAssets(tenantId)
  }

  @Get('pipeline-health')
  async getPipelineHealth(@TenantId() tenantId: string): Promise<PipelineHealth> {
    return this.dashboardsService.getPipelineHealth(tenantId)
  }
}
