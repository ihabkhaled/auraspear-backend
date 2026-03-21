import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { UsageBudgetService } from './usage-budget.service'
import { RequirePermission } from '../../../common/decorators/permission.decorator'
import { TenantId } from '../../../common/decorators/tenant-id.decorator'
import { Permission } from '../../../common/enums'
import { AuthGuard } from '../../../common/guards/auth.guard'
import { TenantGuard } from '../../../common/guards/tenant.guard'
import type { MonthlyUsageResponse, UsageSummaryResponse } from './usage-budget.types'

@ApiTags('ai-usage')
@ApiBearerAuth()
@Controller('ai-usage')
@UseGuards(AuthGuard, TenantGuard)
export class UsageBudgetController {
  constructor(private readonly usageBudgetService: UsageBudgetService) {}

  @Get()
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getUsageSummary(
    @TenantId() tenantId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ): Promise<UsageSummaryResponse> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const start = startDate ? new Date(startDate) : monthStart
    const end = endDate ? new Date(endDate) : now
    return this.usageBudgetService.getUsageSummary(tenantId, start, end)
  }

  @Get('monthly')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getMonthlyUsage(@TenantId() tenantId: string): Promise<MonthlyUsageResponse> {
    return this.usageBudgetService.getMonthlyUsage(tenantId)
  }
}
