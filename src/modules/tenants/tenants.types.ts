export interface TenantRecord {
  id: string
  name: string
  slug: string
  createdAt: Date
}

export interface TenantWithCounts extends TenantRecord {
  userCount: number
  alertCount: number
  caseCount: number
}

export interface UserRecord {
  id: string
  email: string
  name: string
  role: string
  status: string
  lastLoginAt: Date | null
  mfaEnabled: boolean
  isProtected: boolean
  createdAt: Date
}
