import { Injectable, Logger } from '@nestjs/common'
import { AI_REPORT_SERVICE_CLASS_NAME, AI_REPORT_TIME_RANGE_DAYS } from './reports.constants'
import { ReportsRepository } from './reports.repository'
import { AiFeatureKey, AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { AiService } from '../ai/ai.service'
import { DashboardsRepository } from '../dashboards/dashboards.repository'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { AiResponse } from '../ai/ai.types'

@Injectable()
export class AiReportService {
  private readonly logger = new Logger(AiReportService.name)

  constructor(
    private readonly aiService: AiService,
    private readonly dashboardsRepository: DashboardsRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async generateExecutiveReport(
    tenantId: string,
    timeRange: string,
    user: JwtPayload,
    connector?: string
  ): Promise<AiResponse> {
    this.appLogger.info('AI executive report requested', {
      feature: AppLogFeature.AI,
      action: 'generateExecutiveReport',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: AI_REPORT_SERVICE_CLASS_NAME,
      functionName: 'generateExecutiveReport',
      tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      metadata: { timeRange },
    })

    const days = Reflect.get(AI_REPORT_TIME_RANGE_DAYS, timeRange) as number | undefined
    const periodDays = days ?? 7
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
    const now = new Date()

    const [alertsCount, resolvedCount, openCases, criticalAlerts] = await Promise.all([
      this.dashboardsRepository.countAlertsBetween(tenantId, since, now),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, since),
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, since, now),
    ])

    return this.aiService.executeAiTask({
      tenantId,
      userId: user.sub,
      userEmail: user.email,
      featureKey: AiFeatureKey.REPORT_EXECUTIVE,
      context: {
        timeRange,
        periodDays,
        totalAlerts: alertsCount,
        resolvedAlerts: resolvedCount,
        openCases,
        criticalAlerts,
        generatedAt: now.toISOString(),
      },
      connector,
    })
  }
}
