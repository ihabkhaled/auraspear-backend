import { Injectable, Logger } from '@nestjs/common'
import { AiAgentsRepository } from './ai-agents.repository'
import { AiService } from '../ai/ai.service'
import type { Job } from '@prisma/client'

interface AgentTaskPayload {
  agentId?: string
  sessionId?: string
  prompt?: string
  actorUserId?: string
  actorEmail?: string
}

@Injectable()
export class AiAgentTaskHandler {
  private readonly logger = new Logger(AiAgentTaskHandler.name)

  constructor(
    private readonly repository: AiAgentsRepository,
    private readonly aiService: AiService
  ) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = (job.payload as AgentTaskPayload | null) ?? {}
    const { agentId, sessionId, prompt, actorUserId, actorEmail } = payload

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
      })

      const durationMs = Date.now() - startedAt
      const tokensUsed = response.tokensUsed.input + response.tokensUsed.output

      await this.repository.markSessionCompleted({
        sessionId,
        agentId,
        tenantId: job.tenantId,
        output: response.result,
        tokensUsed,
        cost: 0,
        durationMs,
      })

      return {
        agentId,
        sessionId,
        model: response.model,
        tokensUsed,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = error instanceof Error ? error.message : 'Unknown AI agent execution error'

      await this.repository.markSessionFailed({
        sessionId,
        errorMessage: message,
        durationMs,
      })

      throw error
    }
  }
}
