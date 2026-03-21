import { Injectable } from '@nestjs/common'
import { KnowledgeRepository } from './knowledge.repository'
import { AiFeatureKey } from '../../common/enums'
import { AiService } from '../ai/ai.service'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly aiService: AiService,
    private readonly knowledgeRepository: KnowledgeRepository
  ) {}

  async generateRunbook(
    tenantId: string,
    userId: string,
    userEmail: string,
    description: string
  ): Promise<AiResponse> {
    return this.aiService.executeAiTask({
      tenantId,
      userId,
      userEmail,
      featureKey: AiFeatureKey.KNOWLEDGE_GENERATE_RUNBOOK,
      context: { description },
    })
  }

  async searchWithAi(
    tenantId: string,
    userId: string,
    userEmail: string,
    query: string
  ): Promise<AiResponse> {
    const existingRunbooks = await this.knowledgeRepository.search(tenantId, query, 20)
    const runbookTitles = existingRunbooks.map(r => r.title)

    return this.aiService.executeAiTask({
      tenantId,
      userId,
      userEmail,
      featureKey: AiFeatureKey.KNOWLEDGE_SEARCH,
      context: { query, existingRunbooks: JSON.stringify(runbookTitles) },
    })
  }
}
