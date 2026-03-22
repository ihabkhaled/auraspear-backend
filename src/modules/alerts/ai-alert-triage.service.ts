import { Injectable } from '@nestjs/common'
import { AlertsRepository } from './alerts.repository'
import { AiFeatureKey } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AiService } from '../ai/ai.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiAlertTriageService {
  constructor(
    private readonly aiService: AiService,
    private readonly alertsRepository: AlertsRepository
  ) {}

  async triageAlert(
    alertId: string,
    tenantId: string,
    taskType: AiFeatureKey,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    const alert = await this.alertsRepository.findFirstByIdAndTenant(alertId, tenantId)
    if (!alert) {
      throw new BusinessException(404, 'Alert not found', 'errors.alerts.notFound')
    }

    const context: Record<string, unknown> = {
      alertTitle: alert.title ?? '',
      alertDescription: alert.description ?? '',
      alertSeverity: alert.severity,
      alertSource: alert.source ?? '',
      alertRule: alert.ruleName ?? '',
      alertTimestamp: alert.timestamp?.toISOString() ?? '',
      alertRawData: JSON.stringify(alert.rawEvent ?? {}).slice(0, 3000),
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
}
