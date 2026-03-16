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

export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface CheckEmailResult {
  exists: boolean
  user: { id: string; name: string; email: string } | null
  alreadyInTenant: boolean
}

/** Lightweight user info for assignee pickers — accessible to all authenticated users. */
export interface TenantMember {
  id: string
  name: string
  email: string
}

export interface FindOrCreateUserFields {
  id: string
  email: string
  name: string
  lastLoginAt: Date | null
  mfaEnabled: boolean
  isProtected: boolean
}

export interface FindOrCreateMembershipFields {
  role: string
  status: string
  createdAt: Date
}

export interface FindOrCreateUserResult {
  user: FindOrCreateUserFields
  membership: FindOrCreateMembershipFields
  isExisting: boolean
}

/** Response returned by the impersonate-user endpoint. */
export interface ImpersonateUserResponse {
  accessToken: string
  refreshToken: string
  user: {
    sub: string
    email: string
    tenantId: string
    tenantSlug: string
    role: string
  }
  impersonator: {
    sub: string
    email: string
    role: string
    tenantId: string
    tenantSlug: string
  }
}
