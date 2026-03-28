import { toIso } from '../../../common/utils/date-time.utility'
import type {
  MonthlyUsageRawRow,
  MonthlyUsageResponse,
  UsageSummaryEntry,
  UsageSummaryRawRow,
  UsageSummaryResponse,
} from './usage-budget.types'

/* ---------------------------------------------------------------- */
/* USAGE SUMMARY BUILDING                                            */
/* ---------------------------------------------------------------- */

export function buildUsageSummaryResponse(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  rows: UsageSummaryRawRow[]
): UsageSummaryResponse {
  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  let totalRequests = 0

  const entries: UsageSummaryEntry[] = []

  for (const row of rows) {
    const inputTokens = Number(row.total_input)
    const outputTokens = Number(row.total_output)
    const cost = Number(row.total_cost)
    const requestCount = Number(row.request_count)

    totalInput += inputTokens
    totalOutput += outputTokens
    totalCost += cost
    totalRequests += requestCount

    entries.push({
      featureKey: row.feature_key,
      provider: row.provider,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      totalCost: cost,
      requestCount,
    })
  }

  return {
    tenantId,
    startDate: toIso(startDate),
    endDate: toIso(endDate),
    entries,
    totals: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cost: totalCost,
      requests: totalRequests,
    },
  }
}

/* ---------------------------------------------------------------- */
/* MONTHLY USAGE BUILDING                                            */
/* ---------------------------------------------------------------- */

export function buildMonthlyUsageResponse(
  tenantId: string,
  monthLabel: string,
  row: MonthlyUsageRawRow | undefined
): MonthlyUsageResponse {
  const inputTokens = row ? Number(row.total_input) : 0
  const outputTokens = row ? Number(row.total_output) : 0

  return {
    tenantId,
    month: monthLabel,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: row ? Number(row.total_cost) : 0,
    requestCount: row ? Number(row.request_count) : 0,
  }
}
