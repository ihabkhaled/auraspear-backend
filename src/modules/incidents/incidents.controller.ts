import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { type AddTimelineEntryDto, AddTimelineEntrySchema } from './dto/add-timeline-entry.dto'
import { type CreateIncidentDto, CreateIncidentSchema } from './dto/create-incident.dto'
import { ListIncidentsQuerySchema } from './dto/list-incidents-query.dto'
import { type UpdateIncidentDto, UpdateIncidentSchema } from './dto/update-incident.dto'
import { IncidentsService } from './incidents.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { IncidentRecord, IncidentStats, PaginatedIncidents } from './incidents.types'
import type { IncidentTimeline } from '@prisma/client'

@Controller('incidents')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  async listIncidents(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedIncidents> {
    const { page, limit, sortBy, sortOrder, status, severity, category, query } =
      ListIncidentsQuerySchema.parse(rawQuery)
    return this.incidentsService.listIncidents(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      status,
      severity,
      category,
      query
    )
  }

  @Get('stats')
  async getIncidentStats(@TenantId() tenantId: string): Promise<IncidentStats> {
    return this.incidentsService.getIncidentStats(tenantId)
  }

  @Get(':id')
  async getIncidentById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<IncidentRecord> {
    return this.incidentsService.getIncidentById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async createIncident(
    @Body(new ZodValidationPipe(CreateIncidentSchema)) dto: CreateIncidentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<IncidentRecord> {
    return this.incidentsService.createIncident(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateIncident(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIncidentSchema)) dto: UpdateIncidentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<IncidentRecord> {
    return this.incidentsService.updateIncident(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteIncident(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.incidentsService.deleteIncident(id, tenantId, user.email)
  }

  @Get(':id/timeline')
  async getIncidentTimeline(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<IncidentTimeline[]> {
    return this.incidentsService.getIncidentTimeline(id, tenantId)
  }

  @Post(':id/timeline')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async addTimelineEntry(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddTimelineEntrySchema)) dto: AddTimelineEntryDto,
    @CurrentUser() user: JwtPayload
  ): Promise<IncidentTimeline> {
    return this.incidentsService.addTimelineEntry(id, dto, user)
  }
}
