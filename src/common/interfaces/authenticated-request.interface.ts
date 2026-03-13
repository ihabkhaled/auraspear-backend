import type { Request } from 'express'

export enum MembershipStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export enum UserRole {
  GLOBAL_ADMIN = 'GLOBAL_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  SOC_ANALYST_L2 = 'SOC_ANALYST_L2',
  SOC_ANALYST_L1 = 'SOC_ANALYST_L1',
  THREAT_HUNTER = 'THREAT_HUNTER',
  EXECUTIVE_READONLY = 'EXECUTIVE_READONLY',
}

/**
 * Ordered role hierarchy from most privileged to least.
 * A role at index N is more privileged than a role at index N+1.
 */
export const ROLE_HIERARCHY: UserRole[] = [
  UserRole.GLOBAL_ADMIN,
  UserRole.TENANT_ADMIN,
  UserRole.SOC_ANALYST_L2,
  UserRole.THREAT_HUNTER,
  UserRole.SOC_ANALYST_L1,
  UserRole.EXECUTIVE_READONLY,
]

export interface JwtPayload {
  sub: string
  email: string
  tenantId: string
  tenantSlug: string
  role: UserRole
  jti?: string
  iat?: number
  exp?: number
  /** Present and `true` when this token was issued via impersonation. */
  isImpersonated?: boolean
  /** The `sub` (user ID) of the admin who initiated the impersonation. */
  impersonatorSub?: string
  /** The email of the admin who initiated the impersonation. */
  impersonatorEmail?: string
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload
}
