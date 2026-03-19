import type { UserRole } from '../../common/interfaces/authenticated-request.interface'
import type {
  RefreshTokenFamily,
  RefreshTokenRotation,
  TenantMembership,
  User,
} from '@prisma/client'

export interface AuthTenantRecord {
  id: string
  name: string
  slug: string
}

export interface MembershipWithTenant {
  tenantId: string
  status?: string
  role: string
  tenant: AuthTenantRecord
}

export interface TenantMembershipInfo {
  id: string
  name: string
  slug: string
  role: UserRole
}

export interface AuthUserIdentity {
  id: string
  email: string
}

export type UserWithMemberships = User & {
  memberships: Array<TenantMembership & { tenant: AuthTenantRecord }>
}

export type RefreshRotationWithFamily = RefreshTokenRotation & {
  family: RefreshTokenFamily
}

export interface IssuedRefreshToken {
  refreshToken: string
  family: string
  generation: number
  jti: string
  expiresAt: Date
}

export interface AuthorizedTenantContext {
  tenantId: string
  tenantSlug: string
  role: UserRole
}
