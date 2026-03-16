import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ComplianceService } from './compliance.service'
import { type CreateControlDto, CreateControlSchema } from './dto/create-control.dto'
import { type CreateFrameworkDto, CreateFrameworkSchema } from './dto/create-framework.dto'
import { ListFrameworksQuerySchema } from './dto/list-frameworks-query.dto'
import { type UpdateControlDto, UpdateControlSchema } from './dto/update-control.dto'
import { type UpdateFrameworkDto, UpdateFrameworkSchema } from './dto/update-framework.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  ComplianceFrameworkRecord,
  PaginatedFrameworks,
  ComplianceControlRecord,
  ComplianceStats,
} from './compliance.types'

@Controller('compliance')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('frameworks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listFrameworks(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedFrameworks> {
    const { page, limit, sortBy, sortOrder, standard, query } =
      ListFrameworksQuerySchema.parse(rawQuery)
    return this.complianceService.listFrameworks(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      standard,
      query
    )
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getComplianceStats(@TenantId() tenantId: string): Promise<ComplianceStats> {
    return this.complianceService.getComplianceStats(tenantId)
  }

  @Get('frameworks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getFrameworkById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<ComplianceFrameworkRecord> {
    return this.complianceService.getFrameworkById(id, tenantId)
  }

  @Post('frameworks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createFramework(
    @Body(new ZodValidationPipe(CreateFrameworkSchema)) dto: CreateFrameworkDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ComplianceFrameworkRecord> {
    return this.complianceService.createFramework(dto, user)
  }

  @Patch('frameworks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateFramework(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFrameworkSchema)) dto: UpdateFrameworkDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ComplianceFrameworkRecord> {
    return this.complianceService.updateFramework(id, dto, user)
  }

  @Delete('frameworks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteFramework(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.complianceService.deleteFramework(id, tenantId, user.email)
  }

  @Get('frameworks/:id/controls')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listControls(
    @Param('id') frameworkId: string,
    @TenantId() tenantId: string
  ): Promise<ComplianceControlRecord[]> {
    return this.complianceService.listControls(frameworkId, tenantId)
  }

  @Post('frameworks/:id/controls')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createControl(
    @Param('id') frameworkId: string,
    @Body(new ZodValidationPipe(CreateControlSchema)) dto: CreateControlDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ComplianceControlRecord> {
    return this.complianceService.createControl(frameworkId, dto, user)
  }

  @Patch('frameworks/:id/controls/:controlId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateControl(
    @Param('id') frameworkId: string,
    @Param('controlId') controlId: string,
    @Body(new ZodValidationPipe(UpdateControlSchema)) dto: UpdateControlDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ComplianceControlRecord> {
    return this.complianceService.updateControl(frameworkId, controlId, dto, user)
  }
}
