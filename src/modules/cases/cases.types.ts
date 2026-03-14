import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { Case, CaseArtifact, CaseNote, CaseTask, CaseTimeline } from '@prisma/client'

export type CaseRecord = Case & {
  notes: CaseNote[]
  timeline: CaseTimeline[]
  tasks: CaseTask[]
  artifacts: CaseArtifact[]
  ownerName: string | null
  ownerEmail: string | null
  createdByName: string | null
  tenantName: string
}

export type PaginatedCases = PaginatedResponse<
  Case & {
    ownerName: string | null
    ownerEmail: string | null
    createdByName: string | null
    tenantName: string
  }
>

export type PaginatedCaseNotes = PaginatedResponse<CaseNote>
