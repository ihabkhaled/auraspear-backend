import { Injectable } from '@nestjs/common'
import { AttackPathsRepository } from './attack-paths.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiAttackPathService {
  constructor(
    private readonly aiService: AiService,
    private readonly attackPathsRepository: AttackPathsRepository
  ) {}

  async summarize(
    pathId: string,
    tenantId: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const attackPath = await this.attackPathsRepository.findFirst({ id: pathId, tenantId })
    if (!attackPath) {
      throw new BusinessException(404, 'Attack path not found', 'errors.attackPaths.notFound')
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.ATTACK_PATH_SUMMARIZE,
      context: this.buildAttackPathContext(attackPath),
      connector,
    })
  }

  private buildAttackPathContext(
    attackPath: NonNullable<Awaited<ReturnType<AttackPathsRepository['findFirst']>>>
  ): Record<string, unknown> {
    return {
      title: attackPath.title,
      description: attackPath.description ?? '',
      severity: attackPath.severity,
      status: attackPath.status,
      stages: JSON.stringify(attackPath.stages).slice(0, 3000),
      affectedAssets: attackPath.affectedAssets,
      killChainCoverage: attackPath.killChainCoverage,
      mitreTactics: attackPath.mitreTactics.join(', '),
      mitreTechniques: attackPath.mitreTechniques.join(', '),
      detectedAt: attackPath.detectedAt.toISOString(),
    }
  }
}
