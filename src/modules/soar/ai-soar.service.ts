import { Injectable } from '@nestjs/common'
import { SoarRepository } from './soar.repository'
import { AiFeatureKey } from '../../common/enums'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiSoarService {
  constructor(
    private readonly aiService: AiService,
    private readonly soarRepository: SoarRepository
  ) {}

  async draftPlaybook(
    tenantId: string,
    user: JwtPayload,
    description: string
  ): Promise<AiResponse> {
    const existingPlaybooks = await this.soarRepository.findManyPlaybooksWithTenant({
      where: { tenantId },
      skip: 0,
      take: 10,
      orderBy: { createdAt: 'desc' },
    })

    const context: Record<string, unknown> = {
      description,
      existingPlaybooks: existingPlaybooks.map(p => ({
        name: p.name,
        triggerType: p.triggerType,
        status: p.status,
      })),
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.SOAR_PLAYBOOK_DRAFT,
      context,
    })
  }
}
