import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { Case, CaseNote, CaseTimeline } from '@prisma/client'

export type CaseRecord = Case & {
  notes: CaseNote[]
  timeline: CaseTimeline[]
}

export type PaginatedCases = PaginatedResponse<Case>
