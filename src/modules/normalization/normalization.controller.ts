import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
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
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class NormalizationController {
  constructor(private readonly normalizationService: NormalizationService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listPipelinesRoot(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedPipelines> {
    return this.listPipelines(tenantId, rawQuery)
  }

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

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getNormalizationStatsRoot(@TenantId() tenantId: string): Promise<NormalizationStats> {
    return this.normalizationService.getNormalizationStats(tenantId)
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePipelineSchema)) dto: UpdatePipelineDto,
    @CurrentUser() user: JwtPayload
  ): Promise<NormalizationPipelineRecord> {
    return this.normalizationService.updatePipeline(id, dto, user)
  }

  @Delete('pipelines/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deletePipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.normalizationService.deletePipeline(id, tenantId, user.email)
  }
}
