import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { MatchIocsSchema, type MatchIocsDto } from './dto/match-iocs.dto'
import { IntelService } from './intel.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { PaginatedMispEvents, PaginatedIOCs, IOCMatchResult } from './intel.types'

@Controller('ti')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
export class IntelController {
  constructor(private readonly intelService: IntelService) {}

  /**
   * GET /ti/events/recent?page=1&limit=20&sortBy=date&sortOrder=desc
   * Returns recent MISP threat intelligence events, paginated and sorted.
   */
  @Get('events/recent')
  async getRecentEvents(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string
  ): Promise<PaginatedMispEvents> {
    return this.intelService.getRecentEvents(
      tenantId,
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      sortBy,
      sortOrder
    )
  }

  /**
   * GET /ti/iocs/search?q=<query>&type=<iocType>&source=<source>&page=1&limit=20&sortBy=lastSeen&sortOrder=desc
   * Search IOCs by value, with optional type and source filters, and sorting.
   */
  @Get('iocs/search')
  async searchIOCs(
    @TenantId() tenantId: string,
    @Query('q') query?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('source') source?: string
  ): Promise<PaginatedIOCs> {
    return this.intelService.searchIOCs(
      tenantId,
      query ?? '',
      type,
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      sortBy,
      sortOrder,
      source
    )
  }

  /**
   * POST /ti/iocs/match-alerts
   * Match IOCs from MISP against a set of alert IDs.
   * Body: { alertIds: string[] }
   */
  @Post('iocs/match-alerts')
  @Roles(UserRole.SOC_ANALYST_L1)
  async matchIOCsAgainstAlerts(
    @Body(new ZodValidationPipe(MatchIocsSchema)) dto: MatchIocsDto,
    @TenantId() tenantId: string
  ): Promise<IOCMatchResult[]> {
    return this.intelService.matchIOCsAgainstAlerts(tenantId, dto.alertIds)
  }

  /**
   * POST /ti/sync/misp
   * Trigger a sync from the tenant's MISP instance into the local database.
   * Requires TENANT_ADMIN role.
   */
  @Post('sync/misp')
  @Roles(UserRole.TENANT_ADMIN)
  async syncFromMisp(
    @TenantId() tenantId: string
  ): Promise<{ eventsUpserted: number; iocsUpserted: number }> {
    return this.intelService.syncFromMisp(tenantId)
  }
}
