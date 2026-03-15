import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

export interface ReportRecord {
  id: string
  tenantId: string
  name: string
  description: string | null
  type: string
  format: string
  status: string
  parameters: Record<string, unknown> | null
  fileUrl: string | null
  fileSize: number | null
  generatedAt: Date | null
  generatedBy: string
  generatedByName: string | null
  tenantName: string
  createdAt: Date
}

export type PaginatedReports = PaginatedResponse<ReportRecord>

export interface ReportStats {
  totalReports: number
  completedReports: number
  failedReports: number
  generatingReports: number
}
