export interface CaseTimelineEntry {
  id: string
  timestamp: string
  type: string
  actor: string
  description: string
}

export interface CaseNote {
  id: string
  caseId: string
  body: string
  createdBy: string
  createdAt: string
}

export interface CaseLinkedAlert {
  alertId: string
  indexName: string
  linkedAt: string
  linkedBy: string
}

export interface CaseRecord {
  id: string
  caseNumber: string
  tenantId: string
  title: string
  description: string
  severity: string
  status: string
  ownerUserId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  linkedAlerts: CaseLinkedAlert[]
  timeline: CaseTimelineEntry[]
  notes: CaseNote[]
}

export interface PaginatedCases {
  data: Omit<CaseRecord, 'notes'>[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}
