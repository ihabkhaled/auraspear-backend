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
