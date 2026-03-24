import { Injectable } from '@nestjs/common'
import { CloudSecurityRepository } from './cloud-security.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiCloudSecurityService {
  constructor(
    private readonly aiService: AiService,
    private readonly cloudSecurityRepository: CloudSecurityRepository
  ) {}

  async triageFinding(
    findingId: string,
    tenantId: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const finding = await this.cloudSecurityRepository.findFirstFinding({
      id: findingId,
      tenantId,
    })
    if (!finding) {
      throw new BusinessException(
        404,
        'Cloud finding not found',
        'errors.cloudSecurity.findingNotFound'
      )
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.CLOUD_FINDING_TRIAGE,
      context: this.buildFindingContext(finding),
      connector,
    })
  }

  private buildFindingContext(
    finding: NonNullable<Awaited<ReturnType<CloudSecurityRepository['findFirstFinding']>>>
  ): Record<string, unknown> {
    return {
      resourceType: finding.resourceType,
      resourceId: finding.resourceId,
      severity: finding.severity,
      title: finding.title,
      description: finding.description ?? '',
      status: finding.status,
      remediationSteps: finding.remediationSteps ?? '',
      detectedAt: finding.detectedAt.toISOString(),
    }
  }
}
