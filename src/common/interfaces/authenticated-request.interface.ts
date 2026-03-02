import type { Request } from 'express'

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
  iat?: number
  exp?: number
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload
}
