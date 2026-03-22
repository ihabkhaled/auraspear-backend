import { Injectable } from '@nestjs/common'
import { DetectionRulesRepository } from './detection-rules.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiDetectionCopilotService {
  constructor(
    private readonly aiService: AiService,
    private readonly detectionRulesRepository: DetectionRulesRepository
  ) {}

  async analyzeRule(
    ruleId: string,
    tenantId: string,
    taskType: AiFeatureKey,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const rule = await this.detectionRulesRepository.findByIdAndTenant(ruleId, tenantId)
    if (!rule) {
      throw new BusinessException(404, 'Detection rule not found', 'errors.detectionRules.notFound')
    }

    const context: Record<string, unknown> = {
      ruleName: rule.name,
      ruleDescription: rule.description ?? '',
      ruleType: rule.ruleType,
      ruleStatus: rule.status,
      ruleSeverity: rule.severity,
      ruleConditions: JSON.stringify(rule.conditions ?? {}).slice(0, 3000),
      ruleActions: JSON.stringify(rule.actions ?? {}).slice(0, 2000),
      hitCount: rule.hitCount,
      falsePositiveCount: rule.falsePositiveCount,
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

  async draftRule(
    tenantId: string,
    description: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const context: Record<string, unknown> = {
      description,
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.DETECTION_RULE_DRAFT,
      context,
      connector,
    })
  }
}
