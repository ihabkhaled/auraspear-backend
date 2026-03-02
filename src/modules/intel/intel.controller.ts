import { Body, Controller, Get, Post, Query, UseGuards, UsePipes } from '@nestjs/common'
import { MatchIocsSchema, type MatchIocsDto } from './dto/match-iocs.dto'
import { IntelService } from './intel.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'

@Controller('ti')
@UseGuards(AuthGuard, TenantGuard)
export class IntelController {
  constructor(private readonly intelService: IntelService) {}

  /**
   * GET /ti/events/recent?page=1&limit=20
   * Returns recent MISP threat intelligence events, paginated.
   */
  @Get('events/recent')
  async getRecentEvents(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.intelService.getRecentEvents(tenantId, Number(page) || 1, Number(limit) || 20)
  }

  /**
   * GET /ti/iocs/search?q=<query>&type=<iocType>&page=1&limit=20
   * Search IOCs by value, with optional type filter.
   */
  @Get('iocs/search')
  async searchIOCs(
    @TenantId() tenantId: string,
    @Query('q') query?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.intelService.searchIOCs(
      tenantId,
      query ?? '',
      type,
      Number(page) || 1,
      Number(limit) || 20
    )
  }

  /**
   * POST /ti/iocs/match-alerts
   * Match IOCs from MISP against a set of alert IDs.
   * Body: { alertIds: string[] }
   */
  @Post('iocs/match-alerts')
  @UsePipes(new ZodValidationPipe(MatchIocsSchema))
  async matchIOCsAgainstAlerts(@Body() dto: MatchIocsDto, @TenantId() tenantId: string) {
    return this.intelService.matchIOCsAgainstAlerts(tenantId, dto.alertIds)
  }

  /**
   * POST /ti/sync/misp
   * Trigger a sync from the tenant's MISP instance into the local database.
   * Requires TENANT_ADMIN role.
   */
  @Post('sync/misp')
  @Roles(UserRole.TENANT_ADMIN)
  async syncFromMisp(@TenantId() tenantId: string) {
    return this.intelService.syncFromMisp(tenantId)
  }
}
