import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

export interface DetectionRuleRecord {
  id: string
  tenantId: string
  ruleNumber: string
  name: string
  description: string | null
  ruleType: string
  severity: string
  status: string
  conditions: Record<string, unknown>
  actions: Record<string, unknown>
  hitCount: number
  falsePositiveCount: number
  lastTriggeredAt: Date | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type PaginatedDetectionRules = PaginatedResponse<DetectionRuleRecord>

export interface DetectionRuleStats {
  totalRules: number
  activeRules: number
  testingRules: number
  disabledRules: number
  totalMatches: number
}
