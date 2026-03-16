import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

export interface NormalizationPipelineRecord {
  id: string
  tenantId: string
  name: string
  description: string | null
  sourceType: string
  status: string
  parserConfig: Record<string, unknown>
  fieldMappings: Record<string, unknown>
  processedCount: string
  errorCount: number
  lastProcessedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type PaginatedPipelines = PaginatedResponse<NormalizationPipelineRecord>

export interface NormalizationStats {
  totalPipelines: number
  activePipelines: number
  inactivePipelines: number
  errorPipelines: number
  totalEventsProcessed: string
  totalErrors: number
}
