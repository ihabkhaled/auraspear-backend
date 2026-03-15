import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

export interface ComplianceFrameworkRecord {
  id: string
  tenantId: string
  name: string
  description: string | null
  standard: string
  version: string
  totalControls: number
  passedControls: number
  failedControls: number
  complianceScore: number
  tenantName: string
  createdAt: Date
  updatedAt: Date
}

export type PaginatedFrameworks = PaginatedResponse<ComplianceFrameworkRecord>

export interface ComplianceControlRecord {
  id: string
  frameworkId: string
  controlNumber: string
  title: string
  description: string | null
  status: string
  evidence: string | null
  assessedAt: Date | null
  assessedBy: string | null
  assessedByName: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ComplianceStats {
  totalFrameworks: number
  overallComplianceScore: number
  passedControls: number
  failedControls: number
  notAssessedControls: number
  partiallyMetControls: number
}
