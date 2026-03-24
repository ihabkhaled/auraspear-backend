import { Injectable } from '@nestjs/common'
import { CasesRepository } from './cases.repository'
import { buildCaseAiContext } from './cases.utilities'
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

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: taskType,
      context: buildCaseAiContext(caseItem),
      connector,
    })
  }
}
