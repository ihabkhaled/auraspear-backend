import { Injectable } from '@nestjs/common'
import { UebaRepository } from './ueba.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiUebaService {
  constructor(
    private readonly aiService: AiService,
    private readonly uebaRepository: UebaRepository
  ) {}

  async explainAnomaly(
    anomalyId: string,
    tenantId: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const anomaly = await this.uebaRepository.findFirstAnomaly({
      where: { id: anomalyId, tenantId },
    })
    if (!anomaly) {
      throw new BusinessException(404, 'UEBA anomaly not found', 'errors.ueba.anomalyNotFound')
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.UEBA_ANOMALY_EXPLAIN,
      context: this.buildAnomalyContext(anomaly),
      connector,
    })
  }

  private buildAnomalyContext(
    anomaly: NonNullable<Awaited<ReturnType<UebaRepository['findFirstAnomaly']>>>
  ): Record<string, unknown> {
    return {
      anomalyType: anomaly.anomalyType,
      description: anomaly.description,
      severity: anomaly.severity,
      score: anomaly.score,
      resolved: anomaly.resolved,
      detectedAt: anomaly.detectedAt.toISOString(),
      entityName: anomaly.entity.entityName,
      entityType: anomaly.entity.entityType,
    }
  }
}
