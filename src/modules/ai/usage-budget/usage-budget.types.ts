export interface RecordUsageInput {
  tenantId: string
  featureKey: string
  provider: string
  model: string | null
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  userId: string
}

export interface UsageSummaryEntry {
  featureKey: string
  provider: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  requestCount: number
}

export interface UsageSummaryResponse {
  tenantId: string
  startDate: string
  endDate: string
  entries: UsageSummaryEntry[]
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
    requests: number
  }
}

export interface MonthlyUsageResponse {
  tenantId: string
  month: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  requestCount: number
}

export interface BudgetCheckResult {
  allowed: boolean
  used: number
  budget: number | null
}

export interface UsageSummaryRawRow {
  feature_key: string
  provider: string
  total_input: bigint | number
  total_output: bigint | number
  total_cost: number
  request_count: bigint | number
}

export interface MonthlyUsageRawRow {
  total_input: bigint | number
  total_output: bigint | number
  total_cost: number
  request_count: bigint | number
}
