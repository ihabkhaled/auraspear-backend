import { Body, Controller, Get, Post, Query, UseGuards, UsePipes } from '@nestjs/common'
import { MatchIocsSchema, type MatchIocsDto } from './dto/match-iocs.dto'
import { IntelService } from './intel.service'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'

@Controller('ti')
@UseGuards(AuthGuard, TenantGuard)
export class IntelController {
  constructor(private readonly intelService: IntelService) {}

  /**
   * GET /ti/events/recent
   * Returns recent MISP threat intelligence events.
   */
  @Get('events/recent')
  async getRecentEvents(@TenantId() tenantId: string) {
    return this.intelService.getRecentEvents(tenantId)
  }

  /**
   * GET /ti/iocs/search?q=<query>
   * Search IOCs by value, type, source, or severity.
   */
  @Get('iocs/search')
  async searchIOCs(@Query('q') query: string, @TenantId() tenantId: string) {
    return this.intelService.searchIOCs(query ?? '', tenantId)
  }

  /**
   * POST /ti/iocs/match-alerts
   * Match IOCs from MISP against a set of alert IDs.
   * Body: { alertIds: string[] }
   */
  @Post('iocs/match-alerts')
  @UsePipes(new ZodValidationPipe(MatchIocsSchema))
  async matchIOCsAgainstAlerts(@Body() dto: MatchIocsDto, @TenantId() tenantId: string) {
    return this.intelService.matchIOCsAgainstAlerts(dto.alertIds, tenantId)
  }
}
