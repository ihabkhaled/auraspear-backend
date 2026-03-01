import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/interfaces/authenticated-request.interface';
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface';
import { AlertsService } from './alerts.service';
import type { SearchAlertsDto } from './dto/search-alerts.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async search(
    @TenantId() tenantId: string,
    @Query() query: SearchAlertsDto,
  ) {
    return this.alertsService.search(tenantId, query);
  }

  @Get(':id')
  async getById(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.alertsService.findById(tenantId, id);
  }

  @Post(':id/acknowledge')
  @Roles(UserRole.SOC_ANALYST_L1)
  async acknowledge(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.alertsService.acknowledge(tenantId, id, user.email);
  }

  @Post(':id/investigate')
  @Roles(UserRole.SOC_ANALYST_L2)
  async investigate(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.alertsService.investigate(tenantId, id, body.notes);
  }

  @Post(':id/close')
  @Roles(UserRole.SOC_ANALYST_L1)
  async close(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { resolution: string },
  ) {
    return this.alertsService.close(tenantId, id, body.resolution);
  }
}
