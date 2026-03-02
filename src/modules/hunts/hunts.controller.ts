import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { type RunHuntDto, RunHuntSchema } from './dto/run-hunt.dto'
import { HuntsService } from './hunts.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { HuntSessionRecord, PaginatedHuntSessions, PaginatedHuntEvents } from './hunts.types'

@Controller('hunts')
@UseGuards(AuthGuard, TenantGuard)
export class HuntsController {
  constructor(private readonly huntsService: HuntsService) {}

  @Post('run')
  @UseGuards(RolesGuard)
  @Roles(UserRole.THREAT_HUNTER, UserRole.SOC_ANALYST_L2)
  async runHunt(
    @Body(new ZodValidationPipe(RunHuntSchema)) dto: RunHuntDto,
    @CurrentUser() user: JwtPayload
  ): Promise<HuntSessionRecord> {
    return this.huntsService.runHunt(user.tenantId, dto, user.email)
  }

  @Get('runs')
  async listRuns(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<PaginatedHuntSessions> {
    return this.huntsService.listRuns(
      tenantId,
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 20
    )
  }

  @Get('runs/:id')
  async getRunDetails(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<HuntSessionRecord> {
    return this.huntsService.getRun(tenantId, id)
  }

  @Get('runs/:id/events')
  async getRunEvents(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<PaginatedHuntEvents> {
    return this.huntsService.getEvents(
      id,
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 50
    )
  }
}
