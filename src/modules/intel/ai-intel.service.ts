import { Injectable } from '@nestjs/common'
import { IntelRepository } from './intel.repository'
import { buildAdvisoryContext, buildIocEnrichContext } from './intel.utilities'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiIntelService {
  constructor(
    private readonly aiService: AiService,
    private readonly intelRepository: IntelRepository
  ) {}

  async enrichIoc(
    iocId: string,
    tenantId: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const ioc = await this.findIocOrThrow(iocId, tenantId)

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.INTEL_IOC_ENRICH,
      context: buildIocEnrichContext(ioc),
      connector,
    })
  }

  async draftAdvisory(
    tenantId: string,
    user: JwtPayload,
    iocIds: string[],
    connector?: string
  ): Promise<AiResponse> {
    const iocs = await this.intelRepository.findManyIOCs({
      where: { id: { in: iocIds }, tenantId },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    })

    if (iocs.length === 0) {
      throw new BusinessException(404, 'No IOCs found', 'errors.intel.iocNotFound')
    }

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.INTEL_ADVISORY_DRAFT,
      context: buildAdvisoryContext(iocs),
      connector,
    })
  }

  private async findIocOrThrow(
    iocId: string,
    tenantId: string
  ): Promise<{
    iocType: string
    iocValue: string
    source: string | null
    tags: string[]
    firstSeen: Date | null
    lastSeen: Date | null
    active: boolean
  }> {
    const iocs = await this.intelRepository.findManyIOCs({
      where: { id: iocId, tenantId },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 1,
    })

    const ioc = iocs[0]
    if (!ioc) {
      throw new BusinessException(404, 'IOC not found', 'errors.intel.iocNotFound')
    }

    return ioc
  }
}
