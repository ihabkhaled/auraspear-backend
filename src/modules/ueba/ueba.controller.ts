import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ListAnomaliesQuerySchema } from './dto/list-anomalies-query.dto'
import { ListEntitiesQuerySchema } from './dto/list-entities-query.dto'
import { ListModelsQuerySchema } from './dto/list-models-query.dto'
import { UebaService } from './ueba.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import type {
  UebaEntityRecord,
  PaginatedEntities,
  PaginatedAnomalies,
  PaginatedModels,
  UebaStats,
} from './ueba.types'

@Controller('ueba')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles(UserRole.SOC_ANALYST_L2)
export class UebaController {
  constructor(private readonly uebaService: UebaService) {}

  @Get('entities')
  async listEntities(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedEntities> {
    const { page, limit, sortBy, sortOrder, entityType, riskLevel, query } =
      ListEntitiesQuerySchema.parse(rawQuery)
    return this.uebaService.listEntities(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      entityType,
      riskLevel,
      query
    )
  }

  @Get('stats')
  async getUebaStats(@TenantId() tenantId: string): Promise<UebaStats> {
    return this.uebaService.getUebaStats(tenantId)
  }

  @Get('anomalies')
  async listAnomalies(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedAnomalies> {
    const { page, limit, sortBy, sortOrder, severity, entityId, resolved } =
      ListAnomaliesQuerySchema.parse(rawQuery)
    return this.uebaService.listAnomalies(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      severity,
      entityId,
      resolved
    )
  }

  @Get('models')
  async listModels(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedModels> {
    const { page, limit, sortBy, sortOrder, status, modelType } =
      ListModelsQuerySchema.parse(rawQuery)
    return this.uebaService.listModels(tenantId, page, limit, sortBy, sortOrder, status, modelType)
  }

  @Get('entities/:id')
  async getEntityById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<UebaEntityRecord> {
    return this.uebaService.getEntityById(id, tenantId)
  }
}
