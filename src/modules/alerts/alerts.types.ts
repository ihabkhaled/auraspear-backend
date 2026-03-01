export interface Alert {
  id: string
  tenantId: string
  title: string
  description: string
  severity: string
  status: string
  source: string
  ruleId: string
  mitreTactic: string
  mitreTechnique: string
  sourceIp: string
  destIp: string
  agent: string
  timestamp: string
  acknowledgedBy?: string
  acknowledgedAt?: string
  resolution?: string
  closedAt?: string
}

export interface PaginatedResult {
  data: Alert[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
