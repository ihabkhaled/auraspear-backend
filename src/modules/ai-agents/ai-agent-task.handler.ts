import { Injectable, Logger } from '@nestjs/common'
import { AiAgentsRepository } from './ai-agents.repository'
import { AI_COST_PER_1K_INPUT_TOKENS, AI_COST_PER_1K_OUTPUT_TOKENS } from '../ai/ai.constants'
import { AiService } from '../ai/ai.service'
import type { AgentTaskPayload } from './ai-agents.types'
import type { Job } from '@prisma/client'

@Injectable()
export class AiAgentTaskHandler {
  private readonly logger = new Logger(AiAgentTaskHandler.name)

  constructor(
    private readonly repository: AiAgentsRepository,
    private readonly aiService: AiService
  ) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = (job.payload as AgentTaskPayload | null) ?? {}
    const { agentId, connector } = payload

    if (!agentId) {
      throw new Error('agentId is required in job payload')
    }

    // System-triggered jobs (from orchestrator/scheduler) don't have user context
    const sessionId = payload.sessionId ?? null
    const prompt = payload.prompt ?? this.buildSystemPrompt(payload)
    const actorUserId = payload.actorUserId ?? 'system'
    const actorEmail = payload.actorEmail ?? 'system@auraspear.io'

    const startedAt = Date.now()
    const agent = await this.repository.findFirstWithDetails({
      id: agentId,
      tenantId: job.tenantId,
    })
    if (!agent) {
      throw new Error(`AI Agent ${agentId} not found for tenant ${job.tenantId}`)
    }

    let resolvedSessionId = sessionId

    if (resolvedSessionId) {
      const session = await this.repository.findFirstSession({ id: resolvedSessionId, agentId })
      if (!session) {
        throw new Error(`AI Agent session ${resolvedSessionId} not found`)
      }
    } else {
      // System-triggered: auto-create session
      const newSession = await this.repository.createSession({
        agentId,
        input: prompt,
        status: 'running',
      })
      resolvedSessionId = newSession.id
    }

    // Resolve the connector label before execution so it's available for all session states
    const { providerLabel, modelLabel } = await this.aiService.resolveConnectorLabel(
      job.tenantId,
      connector
    )
    const resolvedModel = modelLabel || agent.model

    // Update session with resolved connector info immediately
    await this.repository.updateSessionProviderInfo(resolvedSessionId, providerLabel, resolvedModel)

    try {
      this.logger.log(`Executing AI agent "${agent.name}" for tenant ${job.tenantId}`)

      const response = await this.aiService.runAgentTask({
        tenantId: job.tenantId,
        actorUserId,
        actorEmail,
        agentId,
        agentName: agent.name,
        model: agent.model,
        prompt,
        soulMd: agent.soulMd,
        tools: agent.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
        })),
        connector,
      })

      const durationMs = Date.now() - startedAt
      const tokensUsed = response.tokensUsed.input + response.tokensUsed.output
      const estimatedCost =
        (response.tokensUsed.input / 1000) * AI_COST_PER_1K_INPUT_TOKENS +
        (response.tokensUsed.output / 1000) * AI_COST_PER_1K_OUTPUT_TOKENS

      await this.repository.markSessionCompleted({
        sessionId: resolvedSessionId,
        agentId,
        tenantId: job.tenantId,
        output: response.result,
        model: response.model,
        provider: response.provider,
        tokensUsed,
        cost: estimatedCost,
        durationMs,
      })

      return {
        agentId,
        sessionId: resolvedSessionId,
        model: response.model,
        tokensUsed,
        estimatedCost,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = error instanceof Error ? error.message : 'Unknown AI agent execution error'

      await this.repository.markSessionFailed({
        sessionId: resolvedSessionId,
        errorMessage: message,
        durationMs,
        provider: providerLabel,
        model: resolvedModel,
      })

      throw error
    }
  }

  private buildSystemPrompt(payload: AgentTaskPayload): string {
    const action = payload.actionType ?? 'execute'
    const source = payload.triggeredBy ?? 'system'
    const context = this.resolveSystemContext(payload, action)

    return `System-triggered ${action} task from ${source}. Context: ${context}. Analyze and provide recommendations.`
  }

  private resolveSystemContext(payload: AgentTaskPayload, fallbackAction: string): string {
    if (payload.alertId) {
      return `Alert ID: ${String(payload.alertId)}`
    }
    if (payload.incidentId) {
      return `Incident ID: ${String(payload.incidentId)}`
    }
    if (payload.jobId) {
      return `Job ID: ${String(payload.jobId)}`
    }
    return `Action: ${fallbackAction}`
  }
}
