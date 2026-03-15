import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { type CreatePipelineDto, CreatePipelineSchema } from './dto/create-pipeline.dto'
import { ListPipelinesQuerySchema } from './dto/list-pipelines-query.dto'
import { type UpdatePipelineDto, UpdatePipelineSchema } from './dto/update-pipeline.dto'
import { NormalizationService } from './normalization.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  NormalizationPipelineRecord,
  NormalizationStats,
  PaginatedPipelines,
} from './normalization.types'

@Controller('normalization')
@UseGuards(AuthGuard, TenantGuard)
export class NormalizationController {
  constructor(private readonly normalizationService: NormalizationService) {}

  @Get('pipelines')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listPipelines(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedPipelines> {
    const { page, limit, sortBy, sortOrder, sourceType, status, query } =
      ListPipelinesQuerySchema.parse(rawQuery)
    return this.normalizationService.listPipelines(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      sourceType,
      status,
      query
    )
  }

  @Get('pipelines/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getNormalizationStats(@TenantId() tenantId: string): Promise<NormalizationStats> {
    return this.normalizationService.getNormalizationStats(tenantId)
  }

  @Get('pipelines/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getPipelineById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<NormalizationPipelineRecord> {
    return this.normalizationService.getPipelineById(id, tenantId)
  }

  @Post('pipelines')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createPipeline(
    @Body(new ZodValidationPipe(CreatePipelineSchema)) dto: CreatePipelineDto,
    @CurrentUser() user: JwtPayload
  ): Promise<NormalizationPipelineRecord> {
    return this.normalizationService.createPipeline(dto, user)
  }

  @Patch('pipelines/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updatePipeline(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePipelineSchema)) dto: UpdatePipelineDto,
    @CurrentUser() user: JwtPayload
  ): Promise<NormalizationPipelineRecord> {
    return this.normalizationService.updatePipeline(id, dto, user)
  }

  @Delete('pipelines/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deletePipeline(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.normalizationService.deletePipeline(id, tenantId, user.email)
  }
}
