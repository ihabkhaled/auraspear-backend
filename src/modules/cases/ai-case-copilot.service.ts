import { Injectable } from '@nestjs/common'
import { CasesRepository } from './cases.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiCaseCopilotService {
  constructor(
    private readonly aiService: AiService,
    private readonly casesRepository: CasesRepository
  ) {}

  async analyzeCase(
    caseId: string,
    tenantId: string,
    taskType: AiFeatureKey,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const caseItem = await this.casesRepository.findCaseByIdAndTenant(caseId, tenantId)
    if (!caseItem) {
      throw new BusinessException(404, 'Case not found', 'errors.cases.notFound')
    }

    const context: Record<string, unknown> = {
      caseTitle: caseItem.title ?? '',
      caseDescription: caseItem.description ?? '',
      caseSeverity: caseItem.severity,
      caseStatus: caseItem.status,
      artifacts: (caseItem.artifacts ?? []).slice(0, 10).map(a => ({
        type: a.type,
        value: a.value,
      })),
      tasks: (caseItem.tasks ?? []).slice(0, 10).map(t => ({
        title: t.title,
        status: t.status,
      })),
      timelineEvents: (caseItem.timeline ?? []).slice(0, 20).map(e => ({
        type: e.type,
        description: e.description,
        timestamp: e.timestamp?.toISOString() ?? '',
      })),
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: taskType,
      context,
      connector,
    })
  }
}
