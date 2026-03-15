import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  CreateVulnerabilitySchema,
  type CreateVulnerabilityDto,
} from './dto/create-vulnerability.dto'
import { ListVulnerabilitiesQuerySchema } from './dto/list-vulnerabilities-query.dto'
import {
  UpdateVulnerabilitySchema,
  type UpdateVulnerabilityDto,
} from './dto/update-vulnerability.dto'
import { VulnerabilitiesService } from './vulnerabilities.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  PaginatedVulnerabilities,
  VulnerabilityRecord,
  VulnerabilityStats,
} from './vulnerabilities.types'

@Controller('vulnerabilities')
@UseGuards(AuthGuard, TenantGuard)
export class VulnerabilitiesController {
  constructor(private readonly vulnerabilitiesService: VulnerabilitiesService) {}

  @Get()
  async listVulnerabilities(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedVulnerabilities> {
    const { page, limit, sortBy, sortOrder, severity, patchStatus, exploitAvailable, query } =
      ListVulnerabilitiesQuerySchema.parse(rawQuery)
    return this.vulnerabilitiesService.listVulnerabilities(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      severity,
      patchStatus,
      exploitAvailable,
      query
    )
  }

  @Get('stats')
  async getVulnerabilityStats(@TenantId() tenantId: string): Promise<VulnerabilityStats> {
    return this.vulnerabilitiesService.getVulnerabilityStats(tenantId)
  }

  @Get(':id')
  async getVulnerabilityById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<VulnerabilityRecord> {
    return this.vulnerabilitiesService.getVulnerabilityById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async createVulnerability(
    @Body(new ZodValidationPipe(CreateVulnerabilitySchema)) dto: CreateVulnerabilityDto,
    @CurrentUser() user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    return this.vulnerabilitiesService.createVulnerability(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async updateVulnerability(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVulnerabilitySchema)) dto: UpdateVulnerabilityDto,
    @CurrentUser() user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    return this.vulnerabilitiesService.updateVulnerability(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteVulnerability(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.vulnerabilitiesService.deleteVulnerability(id, tenantId, user.email)
  }
}
