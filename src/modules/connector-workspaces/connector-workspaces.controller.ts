import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ConnectorWorkspacesService } from './connector-workspaces.service'
import {
  PaginationQuerySchema,
  type PaginationQuery,
  WorkspaceSearchSchema,
  type WorkspaceSearchDto,
  WorkspaceActionSchema,
  type WorkspaceActionDto,
  ActionNameSchema,
} from './dto/connector-workspace.dto'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  ConnectorWorkspaceOverview,
  WorkspaceRecentActivityResponse,
  WorkspaceEntitiesResponse,
  WorkspaceSearchResponse,
  WorkspaceActionResponse,
} from './types/connector-workspace.types'

@ApiTags('connector-workspaces')
@ApiBearerAuth()
@Controller('connector-workspaces')
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ConnectorWorkspacesController {
  constructor(private readonly workspacesService: ConnectorWorkspacesService) {}

  @Get(':type/overview')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getOverview(
    @TenantId() tenantId: string,
    @Param('type') type: string
  ): Promise<ConnectorWorkspaceOverview> {
    return this.workspacesService.getOverview(tenantId, type)
  }

  @Get(':type/recent-activity')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getRecentActivity(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery
  ): Promise<WorkspaceRecentActivityResponse> {
    return this.workspacesService.getRecentActivity(tenantId, type, query.page, query.pageSize)
  }

  @Get(':type/entities')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getEntities(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery
  ): Promise<WorkspaceEntitiesResponse> {
    return this.workspacesService.getEntities(tenantId, type, query.page, query.pageSize)
  }

  @Post(':type/search')
  @Roles(UserRole.SOC_ANALYST_L1)
  async search(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Body(new ZodValidationPipe(WorkspaceSearchSchema)) body: WorkspaceSearchDto
  ): Promise<WorkspaceSearchResponse> {
    return this.workspacesService.search(tenantId, type, body)
  }

  @Post(':type/actions/:action')
  @Roles(UserRole.SOC_ANALYST_L2)
  async executeAction(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Param('action') action: string,
    @Body(new ZodValidationPipe(WorkspaceActionSchema)) body: WorkspaceActionDto
  ): Promise<WorkspaceActionResponse> {
    // Validate action name format
    ActionNameSchema.parse(action)

    return this.workspacesService.executeAction(tenantId, type, action, body.params ?? {})
  }
}
