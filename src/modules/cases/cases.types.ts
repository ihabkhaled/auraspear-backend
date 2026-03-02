import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { Case, CaseNote, CaseTimeline } from '@prisma/client'

export type CaseRecord = Case & {
  notes: CaseNote[]
  timeline: CaseTimeline[]
  ownerName: string | null
  ownerEmail: string | null
}

export type PaginatedCases = PaginatedResponse<
  Case & { ownerName: string | null; ownerEmail: string | null }
>
