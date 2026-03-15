import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { CorrelationRule } from '@prisma/client'

export type RuleRecord = CorrelationRule & {
  createdByName: string | null
  tenantName: string
}

export type PaginatedRules = PaginatedResponse<RuleRecord>

export interface CorrelationStats {
  correlationRules: number
  sigmaRules: number
  fired24h: number
  linkedToIncidents: number
}
