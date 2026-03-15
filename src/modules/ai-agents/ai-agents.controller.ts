import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AiAgentsService } from './ai-agents.service'
import { type CreateAgentDto, CreateAgentSchema } from './dto/create-agent.dto'
import { ListAgentsQuerySchema } from './dto/list-agents-query.dto'
import { type UpdateAgentDto, UpdateAgentSchema } from './dto/update-agent.dto'
import { type UpdateSoulDto, UpdateSoulSchema } from './dto/update-soul.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AiAgentRecord, AiAgentStats, PaginatedAgents } from './ai-agents.types'
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AiAgentSession } from '@prisma/client'

@Controller('ai-agents')
@UseGuards(AuthGuard, TenantGuard)
export class AiAgentsController {
  constructor(private readonly aiAgentsService: AiAgentsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listAgents(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedAgents> {
    const { page, limit, sortBy, sortOrder, status, tier, query } =
      ListAgentsQuerySchema.parse(rawQuery)
    return this.aiAgentsService.listAgents(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      status,
      tier,
      query
    )
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getAgentStats(@TenantId() tenantId: string): Promise<AiAgentStats> {
    return this.aiAgentsService.getAgentStats(tenantId)
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getAgentById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.getAgentById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createAgent(
    @Body(new ZodValidationPipe(CreateAgentSchema)) dto: CreateAgentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.createAgent(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateAgent(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAgentSchema)) dto: UpdateAgentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.updateAgent(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteAgent(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.aiAgentsService.deleteAgent(id, tenantId, user.email)
  }

  @Patch(':id/soul')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateSoul(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSoulSchema)) dto: UpdateSoulDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.updateSoul(id, dto, user)
  }

  @Post(':id/stop')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async stopAgent(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.stopAgent(id, tenantId, user.email)
  }

  @Get(':id/sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getAgentSessions(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedResponse<AiAgentSession>> {
    const page = rawQuery['page'] ? Number(rawQuery['page']) : 1
    const limit = rawQuery['limit'] ? Number(rawQuery['limit']) : 20
    return this.aiAgentsService.getAgentSessions(id, tenantId, page, limit)
  }
}
