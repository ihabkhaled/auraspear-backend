import { Injectable, Logger } from '@nestjs/common'
import { USAGE_BUDGET_SERVICE_CLASS_NAME } from './usage-budget.constants'
import { UsageBudgetRepository } from './usage-budget.repository'
import { buildMonthlyUsageResponse, buildUsageSummaryResponse } from './usage-budget.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { FeatureCatalogService } from '../feature-catalog/feature-catalog.service'
import type {
  BudgetCheckResult,
  MonthlyUsageResponse,
  RecordUsageInput,
  UsageSummaryResponse,
} from './usage-budget.types'
import type { AiFeatureKey } from '../../../common/enums'

@Injectable()
export class UsageBudgetService {
  private readonly logger = new Logger(UsageBudgetService.name)

  constructor(
    private readonly repository: UsageBudgetRepository,
    private readonly featureCatalogService: FeatureCatalogService,
    private readonly appLogger: AppLoggerService
  ) {}

  async recordUsage(input: RecordUsageInput): Promise<void> {
    await this.repository.insertUsage(input)
    this.appLogger.debug('AI usage recorded', {
      feature: AppLogFeature.AI,
      action: 'recordUsage',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: USAGE_BUDGET_SERVICE_CLASS_NAME,
      functionName: 'recordUsage',
      tenantId: input.tenantId,
      metadata: {
        featureKey: input.featureKey,
        provider: input.provider,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
      },
    })
  }

  async getUsageSummary(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<UsageSummaryResponse> {
    const rows = await this.repository.getUsageSummary(tenantId, startDate, endDate)
    return buildUsageSummaryResponse(tenantId, startDate, endDate, rows)
  }

  async getMonthlyUsage(tenantId: string): Promise<MonthlyUsageResponse> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const monthLabel = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const rows = await this.repository.getMonthlyUsage(tenantId, monthStart, monthEnd)
    return buildMonthlyUsageResponse(tenantId, monthLabel, rows.at(0))
  }

  async checkBudget(tenantId: string, featureKey: AiFeatureKey): Promise<BudgetCheckResult> {
    const config = await this.featureCatalogService.getConfig(tenantId, featureKey)

    if (config.monthlyTokenBudget === null) {
      return { allowed: true, used: 0, budget: null }
    }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const used = await this.repository.getMonthlyTokenCount(
      tenantId,
      featureKey,
      monthStart,
      monthEnd
    )

    return {
      allowed: used < config.monthlyTokenBudget,
      used,
      budget: config.monthlyTokenBudget,
    }
  }
}
