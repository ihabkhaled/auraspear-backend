import { Injectable, Logger } from '@nestjs/common'
import { AiAgentsRepository } from './ai-agents.repository'
import {
  buildAgentRecord,
  buildAgentListWhere,
  buildAgentOrderBy,
  buildAgentUpdateData,
} from './ai-agents.utilities'
import {
  AiAgentSessionStatus,
  AiAgentStatus,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  SortOrder,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { JobType } from '../jobs/enums/job.enums'
import { JobService } from '../jobs/jobs.service'
import type {
  AiAgentRecord,
  AiAgentStats,
  AgentWithRelations,
  PaginatedAgents,
} from './ai-agents.types'
import type { CreateAgentToolDto, UpdateAgentToolDto } from './dto/agent-tool.dto'
import type { CreateAgentDto } from './dto/create-agent.dto'
import type { ExecuteAgentDto } from './dto/execute-agent.dto'
import type { UpdateAgentDto } from './dto/update-agent.dto'
import type { UpdateSoulDto } from './dto/update-soul.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AiAgentSession, AiAgentTool } from '@prisma/client'

@Injectable()
export class AiAgentsService {
  private readonly logger = new Logger(AiAgentsService.name)

  constructor(
    private readonly repository: AiAgentsRepository,
    private readonly appLogger: AppLoggerService,
    private readonly jobService: JobService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listAgents(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    status?: string,
    tier?: string,
    query?: string
  ): Promise<PaginatedAgents> {
    const where = buildAgentListWhere(tenantId, status, tier, query)

    const [agents, total] = await Promise.all([
      this.repository.findManyWithCounts({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildAgentOrderBy(sortBy, sortOrder),
      }),
      this.repository.count(where),
    ])

    const data = agents.map(agent => {
      const { _count, ...rest } = agent
      return {
        ...rest,
        totalTokens: String(agent.totalTokens),
        toolsCount: _count.tools,
        sessionsCount: _count.sessions,
      }
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getAgentById(id: string, tenantId: string): Promise<AiAgentRecord> {
    const agent = await this.repository.findFirstWithDetails({ id, tenantId })

    if (!agent) {
      this.appLogger.warn('AI Agent not found', {
        feature: AppLogFeature.AI_AGENTS,
        action: 'getAgentById',
        className: 'AiAgentsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { agentId: id, tenantId },
      })
      throw new BusinessException(404, `AI Agent ${id} not found`, 'errors.aiAgents.notFound')
    }

    return buildAgentRecord(agent as unknown as AgentWithRelations)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createAgent(dto: CreateAgentDto, user: JwtPayload): Promise<AiAgentRecord> {
    const existingAgent = await this.repository.findFirstSelect(
      { tenantId: user.tenantId, name: dto.name },
      { id: true }
    )

    if (existingAgent) {
      throw new BusinessException(
        409,
        `Agent with name "${dto.name}" already exists`,
        'errors.aiAgents.nameAlreadyExists'
      )
    }

    const newAgent = await this.repository.createWithDetails({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      model: dto.model,
      tier: dto.tier,
      status: AiAgentStatus.OFFLINE,
      soulMd: dto.soulMd ?? null,
    })

    this.appLogger.info('AI Agent created', {
      feature: AppLogFeature.AI_AGENTS,
      action: 'createAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgent',
      targetResourceId: newAgent.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'createAgent',
      metadata: { name: newAgent.name, tier: newAgent.tier, model: newAgent.model },
    })

    return buildAgentRecord(newAgent as unknown as AgentWithRelations)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateAgent(id: string, dto: UpdateAgentDto, user: JwtPayload): Promise<AiAgentRecord> {
    await this.getAgentById(id, user.tenantId)

    if (dto.name !== undefined) {
      const duplicate = await this.repository.findFirstSelect(
        {
          tenantId: user.tenantId,
          name: dto.name,
          id: { not: id },
        },
        { id: true }
      )

      if (duplicate) {
        throw new BusinessException(
          409,
          `Agent with name "${dto.name}" already exists`,
          'errors.aiAgents.nameAlreadyExists'
        )
      }
    }

    const updated = await this.repository.updateWithDetails({
      where: { id, tenantId: user.tenantId },
      data: buildAgentUpdateData(dto),
    })

    this.appLogger.info('AI Agent updated', {
      feature: AppLogFeature.AI_AGENTS,
      action: 'updateAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'updateAgent',
    })

    return buildAgentRecord(updated as unknown as AgentWithRelations)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteAgent(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getAgentById(id, tenantId)

    await this.repository.deleteMany({ id, tenantId })

    this.appLogger.info(`AI Agent "${existing.name}" deleted`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'deleteAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'deleteAgent',
      metadata: { name: existing.name },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE SOUL                                                       */
  /* ---------------------------------------------------------------- */

  async updateSoul(id: string, dto: UpdateSoulDto, user: JwtPayload): Promise<AiAgentRecord> {
    await this.getAgentById(id, user.tenantId)

    const updated = await this.repository.updateWithDetails({
      where: { id, tenantId: user.tenantId },
      data: { soulMd: dto.soulMd },
    })

    this.appLogger.info('AI Agent SOUL.md updated', {
      feature: AppLogFeature.AI_AGENTS,
      action: 'updateSoul',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'updateSoul',
    })

    return buildAgentRecord(updated as unknown as AgentWithRelations)
  }

  /* ---------------------------------------------------------------- */
  /* GET AGENT SESSIONS                                                */
  /* ---------------------------------------------------------------- */

  async getAgentSessions(
    agentId: string,
    tenantId: string,
    page = 1,
    limit = 20
  ): Promise<PaginatedResponse<AiAgentSession>> {
    // Verify agent exists and belongs to tenant
    await this.getAgentById(agentId, tenantId)

    const where = { agentId }

    const [sessions, total] = await Promise.all([
      this.repository.findManySessions({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { startedAt: SortOrder.DESC },
      }),
      this.repository.countSessions(where),
    ])

    return {
      data: sessions,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getAgentStats(tenantId: string): Promise<AiAgentStats> {
    const [totalAgents, onlineAgents, sessionAgg, costAgg] = await Promise.all([
      this.repository.count({ tenantId }),
      this.repository.count({ tenantId, status: AiAgentStatus.ONLINE }),
      this.repository.countSessions({ agent: { tenantId } }),
      this.repository.aggregate({
        where: { tenantId },
        _sum: {
          totalTokens: true,
          totalCost: true,
        },
      }),
    ])

    return {
      totalAgents,
      onlineAgents,
      totalSessions: sessionAgg,
      totalTokens: String(costAgg._sum?.totalTokens ?? 0),
      totalCost: costAgg._sum?.totalCost ?? 0,
    }
  }

  /* ---------------------------------------------------------------- */
  /* START AGENT                                                       */
  /* ---------------------------------------------------------------- */

  async startAgent(id: string, tenantId: string, actor: string): Promise<AiAgentRecord> {
    const existing = await this.getAgentById(id, tenantId)

    if (existing.status === AiAgentStatus.ONLINE) {
      throw new BusinessException(400, 'Agent is already online', 'errors.aiAgents.alreadyOnline')
    }

    const updated = await this.repository.updateWithDetails({
      where: { id, tenantId },
      data: { status: AiAgentStatus.ONLINE },
    })

    this.appLogger.info(`AI Agent "${existing.name}" started`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'startAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'startAgent',
      metadata: { previousStatus: existing.status },
    })

    return buildAgentRecord(updated as unknown as AgentWithRelations)
  }

  /* ---------------------------------------------------------------- */
  /* STOP AGENT                                                        */
  /* ---------------------------------------------------------------- */

  async stopAgent(id: string, tenantId: string, actor: string): Promise<AiAgentRecord> {
    const existing = await this.getAgentById(id, tenantId)

    if (existing.status === AiAgentStatus.OFFLINE) {
      throw new BusinessException(400, 'Agent is already offline', 'errors.aiAgents.alreadyOffline')
    }

    const updated = await this.repository.updateWithDetails({
      where: { id, tenantId },
      data: { status: AiAgentStatus.OFFLINE },
    })

    this.appLogger.info(`AI Agent "${existing.name}" stopped`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'stopAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'stopAgent',
      metadata: { previousStatus: existing.status },
    })

    return buildAgentRecord(updated as unknown as AgentWithRelations)
  }

  async runAgent(
    id: string,
    dto: ExecuteAgentDto,
    user: JwtPayload
  ): Promise<{ queued: boolean; jobId: string; sessionId: string }> {
    const agent = await this.getAgentById(id, user.tenantId)

    if (agent.status === AiAgentStatus.OFFLINE) {
      throw new BusinessException(409, 'Agent is offline', 'errors.aiAgents.offline')
    }

    const session = await this.repository.createSession({
      agentId: id,
      input: dto.prompt,
      status: AiAgentSessionStatus.RUNNING,
    })

    const job = await this.jobService.enqueue({
      tenantId: user.tenantId,
      type: JobType.AI_AGENT_TASK,
      payload: {
        agentId: id,
        sessionId: session.id,
        prompt: dto.prompt,
        actorUserId: user.sub,
        actorEmail: user.email,
        connector: dto.connector,
      },
      maxAttempts: 2,
      idempotencyKey: `ai-agent:${id}:${session.id}`,
      createdBy: user.email,
    })

    this.appLogger.info('AI Agent execution queued', {
      feature: AppLogFeature.AI_AGENTS,
      action: 'runAgent',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgent',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'runAgent',
      metadata: { sessionId: session.id, jobId: job.id },
    })

    return {
      queued: true,
      jobId: job.id,
      sessionId: session.id,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE TOOL                                                       */
  /* ---------------------------------------------------------------- */

  async createTool(
    agentId: string,
    dto: CreateAgentToolDto,
    user: JwtPayload
  ): Promise<AiAgentTool> {
    const agent = await this.getAgentById(agentId, user.tenantId)

    const existingTool = await this.repository.findFirstTool({
      agentId,
      name: dto.name,
    })

    if (existingTool) {
      throw new BusinessException(
        409,
        `Tool with name "${dto.name}" already exists on this agent`,
        'errors.aiAgents.toolNameAlreadyExists'
      )
    }

    const tool = await this.repository.createTool({
      agentId,
      name: dto.name,
      description: dto.description,
      schema: JSON.parse(JSON.stringify(dto.schema ?? {})),
    })

    this.appLogger.info(`Tool "${tool.name}" created for agent "${agent.name}"`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'createTool',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgentTool',
      targetResourceId: tool.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'createTool',
      metadata: { agentId, toolName: tool.name },
    })

    return tool
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE TOOL                                                       */
  /* ---------------------------------------------------------------- */

  async updateTool(
    agentId: string,
    toolId: string,
    dto: UpdateAgentToolDto,
    user: JwtPayload
  ): Promise<AiAgentTool> {
    await this.getAgentById(agentId, user.tenantId)

    const existingTool = await this.repository.findFirstTool({ id: toolId, agentId })

    if (!existingTool) {
      throw new BusinessException(
        404,
        `Tool ${toolId} not found on agent ${agentId}`,
        'errors.aiAgents.toolNotFound'
      )
    }

    if (dto.name !== undefined) {
      const duplicate = await this.repository.findFirstTool({
        agentId,
        name: dto.name,
        id: { not: toolId },
      })

      if (duplicate) {
        throw new BusinessException(
          409,
          `Tool with name "${dto.name}" already exists on this agent`,
          'errors.aiAgents.toolNameAlreadyExists'
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (dto.name !== undefined) {
      updateData['name'] = dto.name
    }
    if (dto.description !== undefined) {
      updateData['description'] = dto.description
    }
    if (dto.schema !== undefined) {
      updateData['schema'] = JSON.parse(JSON.stringify(dto.schema))
    }
    const updated = await this.repository.updateTool({ id: toolId }, updateData)

    this.appLogger.info(`Tool "${updated.name}" updated on agent ${agentId}`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'updateTool',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AiAgentTool',
      targetResourceId: toolId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'updateTool',
      metadata: { agentId },
    })

    return updated
  }

  /* ---------------------------------------------------------------- */
  /* DELETE TOOL                                                       */
  /* ---------------------------------------------------------------- */

  async deleteTool(
    agentId: string,
    toolId: string,
    tenantId: string,
    actorEmail: string
  ): Promise<{ deleted: boolean }> {
    await this.getAgentById(agentId, tenantId)

    const existingTool = await this.repository.findFirstTool({ id: toolId, agentId })

    if (!existingTool) {
      throw new BusinessException(
        404,
        `Tool ${toolId} not found on agent ${agentId}`,
        'errors.aiAgents.toolNotFound'
      )
    }

    await this.repository.deleteTool({ id: toolId })

    this.appLogger.info(`Tool "${existingTool.name}" deleted from agent ${agentId}`, {
      feature: AppLogFeature.AI_AGENTS,
      action: 'deleteTool',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail,
      targetResource: 'AiAgentTool',
      targetResourceId: toolId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiAgentsService',
      functionName: 'deleteTool',
      metadata: { agentId, toolName: existingTool.name },
    })

    return { deleted: true }
  }
}
