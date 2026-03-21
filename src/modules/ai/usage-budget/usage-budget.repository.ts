import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import type { MonthlyUsageRawRow, RecordUsageInput, UsageSummaryRawRow } from './usage-budget.types'

@Injectable()
export class UsageBudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertUsage(input: RecordUsageInput): Promise<void> {
    await this.prisma.aiUsageLedger.create({
      data: {
        tenantId: input.tenantId,
        featureKey: input.featureKey,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: input.estimatedCost,
        userId: input.userId,
      },
    })
  }

  async getUsageSummary(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<UsageSummaryRawRow[]> {
    return this.prisma.$queryRaw<UsageSummaryRawRow[]>`
      SELECT
        feature_key,
        provider,
        COALESCE(SUM(input_tokens), 0)  AS total_input,
        COALESCE(SUM(output_tokens), 0) AS total_output,
        COALESCE(SUM(estimated_cost), 0) AS total_cost,
        COUNT(*)                         AS request_count
      FROM ai_usage_ledger
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY feature_key, provider
      ORDER BY total_cost DESC
    `
  }

  async getMonthlyUsage(
    tenantId: string,
    monthStart: Date,
    monthEnd: Date
  ): Promise<MonthlyUsageRawRow[]> {
    return this.prisma.$queryRaw<MonthlyUsageRawRow[]>`
      SELECT
        COALESCE(SUM(input_tokens), 0)  AS total_input,
        COALESCE(SUM(output_tokens), 0) AS total_output,
        COALESCE(SUM(estimated_cost), 0) AS total_cost,
        COUNT(*)                         AS request_count
      FROM ai_usage_ledger
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at >= ${monthStart}
        AND created_at < ${monthEnd}
    `
  }

  async getMonthlyTokenCount(
    tenantId: string,
    featureKey: string,
    monthStart: Date,
    monthEnd: Date
  ): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ total: bigint | number }>>`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
      FROM ai_usage_ledger
      WHERE tenant_id = ${tenantId}::uuid
        AND feature_key = ${featureKey}
        AND created_at >= ${monthStart}
        AND created_at < ${monthEnd}
    `
    const row = result.at(0)
    return row ? Number(row.total) : 0
  }
}
