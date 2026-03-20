import { createHash } from 'node:crypto'
import { DEFAULT_REFRESH_EXPIRY_SECONDS } from './auth.constants'
import { AuthExpiryUnit } from './auth.enums'
import type { AuthUserIdentity, MembershipWithTenant, TenantMembershipInfo } from './auth.types'
import type { JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'

export function mapMembershipsToTenantInfos(
  memberships: MembershipWithTenant[]
): TenantMembershipInfo[] {
  return memberships.map(m => ({
    id: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
    role: m.role as UserRole,
  }))
}

/* ---------------------------------------------------------------- */
/* PAYLOAD BUILDING                                                  */
/* ---------------------------------------------------------------- */

export function buildPayloadFromMembership(
  user: AuthUserIdentity,
  membership: MembershipWithTenant
): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
    role: membership.role as UserRole,
  }
}

export function preserveImpersonationClaims(newPayload: JwtPayload, original: JwtPayload): void {
  if (original.isImpersonated === true) {
    newPayload.isImpersonated = true
    newPayload.impersonatorSub = original.impersonatorSub
    newPayload.impersonatorEmail = original.impersonatorEmail
  }
}

/* ---------------------------------------------------------------- */
/* TOKEN TTL                                                         */
/* ---------------------------------------------------------------- */

export function computeRemainingTtl(exp: number): number {
  const now = Math.floor(Date.now() / 1000)
  return Math.max(exp - now, 0)
}

export function computeRemainingTtlFromDate(expiresAt: Date): number {
  return Math.max(Math.ceil((expiresAt.getTime() - Date.now()) / 1000), 0)
}

export function buildExpiryDateFromSeconds(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000)
}

export function hashTokenIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex')
}

/* ---------------------------------------------------------------- */
/* EXPIRY PARSING                                                    */
/* ---------------------------------------------------------------- */

/**
 * Parse a JWT expiry string (e.g., '7d', '15m', '1h') into seconds.
 * Returns a default of 604800 (7 days) if parsing fails.
 */
export function parseExpiryToSeconds(expiry: string): number {
  const match = /^(\d+)([smhdw])$/i.exec(expiry)
  if (!match) {
    return DEFAULT_REFRESH_EXPIRY_SECONDS
  }

  const valuePart = match[1]
  const unitPart = match[2]?.toLowerCase()
  if (valuePart === undefined || unitPart === undefined) {
    return DEFAULT_REFRESH_EXPIRY_SECONDS
  }

  const value = Number.parseInt(valuePart, 10)
  switch (unitPart) {
    case AuthExpiryUnit.SECOND:
      return value
    case AuthExpiryUnit.MINUTE:
      return value * 60
    case AuthExpiryUnit.HOUR:
      return value * 3600
    case AuthExpiryUnit.DAY:
      return value * 86400
    case AuthExpiryUnit.WEEK:
      return value * DEFAULT_REFRESH_EXPIRY_SECONDS
    default:
      return DEFAULT_REFRESH_EXPIRY_SECONDS
  }
}
