import { Injectable } from '@nestjs/common'
import { EntitiesRepository } from './entities.repository'
import { RiskScoringService } from './risk-scoring.service'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiEntityService {
  constructor(
    private readonly aiService: AiService,
    private readonly entitiesRepository: EntitiesRepository,
    private readonly riskScoringService: RiskScoringService
  ) {}

  async explainRisk(entityId: string, tenantId: string, user: JwtPayload): Promise<AiResponse> {
    const entity = await this.entitiesRepository.findFirstByIdAndTenant(entityId, tenantId)
    if (!entity) {
      throw new BusinessException(404, 'Entity not found', 'errors.entities.notFound')
    }

    const breakdown = await this.riskScoringService.getEntityRiskBreakdown(entityId, tenantId)
    const relations = await this.entitiesRepository.findRelationsForEntity(entityId, tenantId)

    const context: Record<string, unknown> = {
      entityType: entity.type,
      entityValue: entity.value,
      entityDisplayName: entity.displayName ?? '',
      riskScore: entity.riskScore,
      riskBreakdown: JSON.stringify(breakdown.factors),
      relationCount: relations.length,
      firstSeen: entity.firstSeen.toISOString(),
      lastSeen: entity.lastSeen.toISOString(),
      metadata: JSON.stringify(entity.metadata ?? {}).slice(0, 2000),
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.ENTITY_RISK_EXPLAIN,
      context,
    })
  }
}
