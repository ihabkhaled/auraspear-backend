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
    const { agentId, sessionId, prompt, actorUserId, actorEmail, connector } = payload

    if (!agentId || !sessionId || !prompt || !actorUserId || !actorEmail) {
      throw new Error('agentId, sessionId, prompt, actorUserId, and actorEmail are required')
    }

    const startedAt = Date.now()
    const agent = await this.repository.findFirstWithDetails({
      id: agentId,
      tenantId: job.tenantId,
    })
    if (!agent) {
      throw new Error(`AI Agent ${agentId} not found for tenant ${job.tenantId}`)
    }

    const session = await this.repository.findFirstSession({ id: sessionId, agentId })
    if (!session) {
      throw new Error(`AI Agent session ${sessionId} not found`)
    }

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
        sessionId,
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
        sessionId,
        model: response.model,
        tokensUsed,
        estimatedCost,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = error instanceof Error ? error.message : 'Unknown AI agent execution error'

      await this.repository.markSessionFailed({
        sessionId,
        errorMessage: message,
        durationMs,
        provider: connector ?? undefined,
      })

      throw error
    }
  }
}
