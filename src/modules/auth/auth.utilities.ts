import { createHash } from 'node:crypto'
import {
  type UserRole,
  type JwtPayload,
} from '../../common/interfaces/authenticated-request.interface'

/* ---------------------------------------------------------------- */
/* TENANT MEMBERSHIP MAPPING                                         */
/* ---------------------------------------------------------------- */

interface MembershipWithTenant {
  tenantId: string
  role: string
  tenant: { id: string; name: string; slug: string }
}

export interface TenantMembershipInfo {
  id: string
  name: string
  slug: string
  role: UserRole
}

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
  user: { id: string; email: string },
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

export function buildExpiryDateFromSeconds(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000)
}

export function hashTokenIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex')
}

/* ---------------------------------------------------------------- */
/* EXPIRY PARSING                                                    */
/* ---------------------------------------------------------------- */

const EXPIRY_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
}

/**
 * Parse a JWT expiry string (e.g., '7d', '15m', '1h') into seconds.
 * Returns a default of 604800 (7 days) if parsing fails.
 */
export function parseExpiryToSeconds(expiry: string): number {
  const match = /^(\d+)([smhdw])$/i.exec(expiry)
  if (!match) {
    return 604800 // default 7 days
  }
  const value = Number.parseInt(match[1] ?? '7', 10)
  const unit = (match[2] ?? 'd').toLowerCase()
  const multiplier = EXPIRY_UNITS[unit]
  if (multiplier === undefined) {
    return 604800
  }
  return value * multiplier
}
