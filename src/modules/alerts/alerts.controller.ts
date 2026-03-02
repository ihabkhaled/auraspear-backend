import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AlertsService } from './alerts.service'
import { CloseAlertSchema, type CloseAlertDto } from './dto/close-alert.dto'
import { InvestigateAlertSchema, type InvestigateAlertDto } from './dto/investigate-alert.dto'
import { SearchAlertsSchema } from './dto/search-alerts.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async search(@TenantId() tenantId: string, @Query() rawQuery: Record<string, string>) {
    const query = SearchAlertsSchema.parse(rawQuery)
    return this.alertsService.search(tenantId, query)
  }

  @Get(':id')
  async getById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.alertsService.findById(tenantId, id)
  }

  @Post(':id/acknowledge')
  @Roles(UserRole.SOC_ANALYST_L1)
  async acknowledge(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.alertsService.acknowledge(tenantId, id, user.email)
  }

  @Post(':id/investigate')
  @Roles(UserRole.SOC_ANALYST_L2)
  async investigate(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InvestigateAlertSchema)) dto: InvestigateAlertDto
  ) {
    return this.alertsService.investigate(tenantId, id, dto.notes)
  }

  @Post(':id/close')
  @Roles(UserRole.SOC_ANALYST_L1)
  async close(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CloseAlertSchema)) dto: CloseAlertDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.alertsService.close(tenantId, id, dto.resolution, user.email)
  }

  @Post('ingest/wazuh')
  @Roles(UserRole.TENANT_ADMIN)
  async ingestFromWazuh(@TenantId() tenantId: string) {
    return this.alertsService.ingestFromWazuh(tenantId)
  }
}
