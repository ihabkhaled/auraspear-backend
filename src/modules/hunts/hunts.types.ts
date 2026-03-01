export interface HuntEvent {
  id: string
  timestamp: string
  severity: string
  eventId: string
  sourceIp: string
  user: string
  description: string
}

export interface HuntRunResult {
  id: string
  tenantId: string
  query: string
  timeRange: string
  description: string | null
  status: 'running' | 'completed' | 'error'
  startedAt: string
  completedAt: string | null
  startedBy: string
  eventsFound: number
  events: HuntEvent[]
  reasoning: string[]
}
