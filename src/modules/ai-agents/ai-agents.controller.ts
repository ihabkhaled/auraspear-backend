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
import { AiAgentsService } from './ai-agents.service'
import { type CreateAgentDto, CreateAgentSchema } from './dto/create-agent.dto'
import { ListAgentsQuerySchema } from './dto/list-agents-query.dto'
import { type UpdateAgentDto, UpdateAgentSchema } from './dto/update-agent.dto'
import { type UpdateSoulDto, UpdateSoulSchema } from './dto/update-soul.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermission } from '../../common/decorators/permission.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { Permission } from '../../common/enums'
import { AuthGuard } from '../../common/guards/auth.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AiAgentRecord, AiAgentStats, PaginatedAgents } from './ai-agents.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AiAgentSession } from '@prisma/client'

@Controller('ai-agents')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AiAgentsController {
  constructor(private readonly aiAgentsService: AiAgentsService) {}

  @Get()
  @RequirePermission(Permission.AI_AGENTS_VIEW)
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
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getAgentStats(@TenantId() tenantId: string): Promise<AiAgentStats> {
    return this.aiAgentsService.getAgentStats(tenantId)
  }

  @Get(':id')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getAgentById(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.getAgentById(id, tenantId)
  }

  @Post()
  @RequirePermission(Permission.AI_AGENTS_CREATE)
  async createAgent(
    @Body(new ZodValidationPipe(CreateAgentSchema)) dto: CreateAgentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.createAgent(dto, user)
  }

  @Patch(':id')
  @RequirePermission(Permission.AI_AGENTS_UPDATE)
  async updateAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateAgentSchema)) dto: UpdateAgentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.updateAgent(id, dto, user)
  }

  @Delete(':id')
  @RequirePermission(Permission.AI_AGENTS_DELETE)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.aiAgentsService.deleteAgent(id, tenantId, user.email)
  }

  @Patch(':id/soul')
  @RequirePermission(Permission.AI_AGENTS_UPDATE)
  async updateSoul(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSoulSchema)) dto: UpdateSoulDto,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.updateSoul(id, dto, user)
  }

  @Post(':id/start')
  @RequirePermission(Permission.AI_AGENTS_UPDATE)
  async startAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.startAgent(id, tenantId, user.email)
  }

  @Post(':id/stop')
  @RequirePermission(Permission.AI_AGENTS_UPDATE)
  async stopAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<AiAgentRecord> {
    return this.aiAgentsService.stopAgent(id, tenantId, user.email)
  }

  @Get(':id/sessions')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getAgentSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedResponse<AiAgentSession>> {
    const page = rawQuery['page'] ? Number(rawQuery['page']) : 1
    const limit = rawQuery['limit'] ? Number(rawQuery['limit']) : 20
    return this.aiAgentsService.getAgentSessions(id, tenantId, page, limit)
  }
}
