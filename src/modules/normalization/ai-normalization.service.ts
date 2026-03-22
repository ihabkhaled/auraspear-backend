import { Injectable } from '@nestjs/common'
import { NormalizationService } from './normalization.service'
import { extractPipelineSteps } from './normalization.utilities'
import { AiFeatureKey } from '../../common/enums'
import { AiService } from '../ai/ai.service'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiNormalizationService {
  constructor(
    private readonly aiService: AiService,
    private readonly normalizationService: NormalizationService
  ) {}

  async verifyPipeline(
    tenantId: string,
    userId: string,
    userEmail: string,
    pipelineId: string,
    sampleEvents: Record<string, unknown>[],
    connector?: string
  ): Promise<AiResponse> {
    const pipeline = await this.normalizationService.getPipelineById(pipelineId, tenantId)

    const steps = extractPipelineSteps(pipeline.parserConfig, pipeline.fieldMappings)

    // Execute a dry-run to get normalized output for the sample events
    const { normalizedEvents } = await this.normalizationService.dryRunPipeline(
      pipelineId,
      tenantId,
      sampleEvents,
      userEmail
    )

    const context: Record<string, unknown> = {
      pipelineName: pipeline.name,
      pipelineConfig: JSON.stringify(steps),
      sampleEvents: JSON.stringify(sampleEvents.slice(0, 5)),
      normalizedOutput: JSON.stringify(normalizedEvents.slice(0, 5)),
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId,
      userEmail,
      featureKey: AiFeatureKey.NORMALIZATION_VERIFY,
      context,
      connector,
    })
  }
}
