import { Injectable, Logger } from '@nestjs/common'
import { BASE_EXISTENCE_SCORE, MAX_RISK_SCORE, RELATION_WEIGHT } from './entities.constants'
import { EntitiesRepository } from './entities.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { EntityRecord, RiskBreakdownFactor, RiskBreakdownResponse } from './entities.types'

@Injectable()
export class RiskScoringService {
  private readonly logger = new Logger(RiskScoringService.name)

  constructor(
    private readonly entitiesRepository: EntitiesRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  calculateRiskScore(entity: EntityRecord, relationCount: number): number {
    let score = BASE_EXISTENCE_SCORE

    // Factor 1: Relation count (more relations = higher risk exposure)
    score += Math.min(relationCount * RELATION_WEIGHT, 30)

    // Factor 2: Entity type weight
    const typeWeights: Record<string, number> = {
      ip: 15,
      domain: 12,
      hash: 20,
      url: 18,
      email: 10,
      user: 8,
      process: 15,
      file: 12,
      hostname: 8,
      asset: 5,
    }
    const typeWeight = typeWeights[entity.type] ?? 5
    score += typeWeight

    // Factor 3: Recency — more recently seen is higher risk
    const daysSinceLastSeen = Math.max(
      0,
      (Date.now() - new Date(entity.lastSeen).getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysSinceLastSeen < 1) {
      score += 15
    } else if (daysSinceLastSeen < 7) {
      score += 10
    } else if (daysSinceLastSeen < 30) {
      score += 5
    }

    return Math.min(score, MAX_RISK_SCORE)
  }

  async getEntityRiskBreakdown(entityId: string, tenantId: string): Promise<RiskBreakdownResponse> {
    const entity = await this.entitiesRepository.findFirstByIdAndTenant(entityId, tenantId)

    if (!entity) {
      throw new BusinessException(404, 'Entity not found', 'errors.entities.notFound')
    }

    const relations = await this.entitiesRepository.findRelationsForEntity(entityId, tenantId)
    const relationCount = relations.length

    const factors: RiskBreakdownFactor[] = []

    // Base score
    factors.push({
      factor: 'base_existence',
      score: BASE_EXISTENCE_SCORE,
      description: 'Base score for entity existence in the graph',
    })

    // Relation count
    const relationScore = Math.min(relationCount * RELATION_WEIGHT, 30)
    if (relationScore > 0) {
      factors.push({
        factor: 'relation_count',
        score: relationScore,
        description: `Entity has ${String(relationCount)} relationships`,
      })
    }

    // Entity type
    const typeWeights: Record<string, number> = {
      ip: 15,
      domain: 12,
      hash: 20,
      url: 18,
      email: 10,
      user: 8,
      process: 15,
      file: 12,
      hostname: 8,
      asset: 5,
    }
    const typeWeight = typeWeights[entity.type] ?? 5
    factors.push({
      factor: 'entity_type',
      score: typeWeight,
      description: `Entity type "${entity.type}" inherent risk weight`,
    })

    // Recency
    const daysSinceLastSeen = Math.max(
      0,
      (Date.now() - new Date(entity.lastSeen).getTime()) / (1000 * 60 * 60 * 24)
    )
    let recencyScore = 0
    if (daysSinceLastSeen < 1) {
      recencyScore = 15
    } else if (daysSinceLastSeen < 7) {
      recencyScore = 10
    } else if (daysSinceLastSeen < 30) {
      recencyScore = 5
    }
    if (recencyScore > 0) {
      factors.push({
        factor: 'recency',
        score: recencyScore,
        description: `Last seen ${Math.round(daysSinceLastSeen)} days ago`,
      })
    }

    const totalScore = Math.min(
      factors.reduce((sum, f) => sum + f.score, 0),
      MAX_RISK_SCORE
    )

    this.appLogger.info('Risk breakdown calculated', {
      feature: AppLogFeature.ENTITIES,
      action: 'riskBreakdown',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'RiskScoringService',
      functionName: 'getEntityRiskBreakdown',
      metadata: { entityId, totalScore },
    })

    return { entityId, totalScore, factors }
  }

  async recalculateForTenant(tenantId: string): Promise<number> {
    const entities = await this.entitiesRepository.findAllByTenant(tenantId)
    let updatedCount = 0

    for (const entity of entities) {
      const relations = await this.entitiesRepository.findRelationsForEntity(entity.id, tenantId)
      const newScore = this.calculateRiskScore(entity, relations.length)

      if (Math.abs(newScore - entity.riskScore) > 0.01) {
        await this.entitiesRepository.updateRiskScore(entity.id, tenantId, newScore)
        updatedCount++
      }
    }

    this.logger.log(
      `Recalculated risk scores for tenant ${tenantId}: ${String(updatedCount)} entities updated`
    )

    return updatedCount
  }
}
