export interface MISPTag {
  id: string
  name: string
  color: string
}

export interface MISPEvent {
  id: string
  eventId: string
  organization: string
  threatLevel: string
  info: string
  date: string
  tags: MISPTag[]
  attributeCount: number
  published: boolean
}

export interface IOCSearchResult {
  id: string
  iocValue: string
  iocType: string
  source: string
  hitCount: number
  lastSeen: string
  severity: string
}

export interface IOCMatchResult {
  alertId: string
  matchedIOCs: {
    iocValue: string
    iocType: string
    source: string
    severity: string
  }[]
  matchCount: number
}
