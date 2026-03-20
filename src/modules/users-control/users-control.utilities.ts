import { Prisma } from '@prisma/client'
import { UsersControlSessionSortField, UsersControlUserSortField } from './users-control.enums'
import { type SortOrder, UserSessionBrowser, UserSessionStatus } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { isUserSessionOnline } from '../auth/auth-session.utilities'
import type {
  UsersControlPagination,
  UsersControlSessionItem,
  UsersControlSessionRecord,
  UsersControlSummary,
  UsersControlUserListItem,
  UsersControlUserRecord,
} from './users-control.types'

function detectBrowser(userAgent: string | null): UserSessionBrowser {
  if (!userAgent) {
    return UserSessionBrowser.UNKNOWN
  }

  if (/SamsungBrowser/i.test(userAgent)) {
    return UserSessionBrowser.SAMSUNG_INTERNET
  }

  if (/Edg/i.test(userAgent)) {
    return UserSessionBrowser.EDGE
  }

  if (/OPR|Opera/i.test(userAgent)) {
    return UserSessionBrowser.OPERA
  }

  if (/Firefox/i.test(userAgent)) {
    return UserSessionBrowser.FIREFOX
  }

  if (/Chrome|CriOS/i.test(userAgent)) {
    return UserSessionBrowser.CHROME
  }

  if (/Safari/i.test(userAgent)) {
    return UserSessionBrowser.SAFARI
  }

  return UserSessionBrowser.UNKNOWN
}

function getScopedMembership(
  memberships: UsersControlUserRecord['memberships'],
  tenantId?: string
): UsersControlUserRecord['memberships'][number] | null {
  if (tenantId) {
    const membership = memberships.find(item => item.tenantId === tenantId)
    return membership ?? null
  }

  return memberships[0] ?? null
}

function buildSessionPlatforms(
  sessions: UsersControlUserRecord['sessions']
): UsersControlUserListItem['sessionPlatforms'] {
  const platforms = new Set<UsersControlUserListItem['sessionPlatforms'][number]>()

  for (const session of sessions) {
    platforms.add(session.osFamily as UsersControlUserListItem['sessionPlatforms'][number])
  }

  return [...platforms]
}

export function assertUsersControlRole(role: UserRole): void {
  if (role === UserRole.GLOBAL_ADMIN || role === UserRole.TENANT_ADMIN) {
    return
  }

  throw new BusinessException(
    403,
    'Only global admins and tenant admins can access users control',
    'errors.auth.insufficientPermissions'
  )
}

export function buildUsersControlUserWhere(
  search: string | undefined,
  tenantId?: string
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    memberships: {
      some: tenantId ? { tenantId } : {},
    },
  }

  if (search && search.trim().length > 0) {
    where.OR = [
      {
        name: {
          contains: search.trim(),
          mode: Prisma.QueryMode.insensitive,
        },
      },
      {
        email: {
          contains: search.trim(),
          mode: Prisma.QueryMode.insensitive,
        },
      },
    ]
  }

  return where
}

export function buildUsersControlUserOrderBy(
  sortBy: UsersControlUserSortField,
  sortOrder: SortOrder
): Prisma.UserOrderByWithRelationInput {
  switch (sortBy) {
    case UsersControlUserSortField.EMAIL:
      return { email: sortOrder }
    case UsersControlUserSortField.LAST_LOGIN_AT:
      return { lastLoginAt: sortOrder }
    case UsersControlUserSortField.CREATED_AT:
      return { createdAt: sortOrder }
    case UsersControlUserSortField.NAME:
    default:
      return { name: sortOrder }
  }
}

function compareNullableStrings(
  left: string | null,
  right: string | null,
  sortOrder: SortOrder
): number {
  const leftValue = left ?? ''
  const rightValue = right ?? ''
  const comparison = leftValue.localeCompare(rightValue)

  return sortOrder === 'asc' ? comparison : comparison * -1
}

function compareNullableDates(left: Date | null, right: Date | null, sortOrder: SortOrder): number {
  const leftValue = left?.getTime() ?? 0
  const rightValue = right?.getTime() ?? 0
  const comparison = leftValue - rightValue

  return sortOrder === 'asc' ? comparison : comparison * -1
}

function compareNumbers(left: number, right: number, sortOrder: SortOrder): number {
  const comparison = left - right

  return sortOrder === 'asc' ? comparison : comparison * -1
}

function comparePlatformLists(
  left: UsersControlUserListItem['sessionPlatforms'],
  right: UsersControlUserListItem['sessionPlatforms'],
  sortOrder: SortOrder
): number {
  const leftValue = [...left].sort().join(',')
  const rightValue = [...right].sort().join(',')
  const comparison = leftValue.localeCompare(rightValue)

  return sortOrder === 'asc' ? comparison : comparison * -1
}

export function buildUsersControlSessionOrderBy(
  sortBy: UsersControlSessionSortField,
  sortOrder: SortOrder
): Prisma.UserSessionOrderByWithRelationInput {
  switch (sortBy) {
    case UsersControlSessionSortField.LAST_LOGIN_AT:
      return { lastLoginAt: sortOrder }
    case UsersControlSessionSortField.CREATED_AT:
      return { createdAt: sortOrder }
    case UsersControlSessionSortField.LAST_SEEN_AT:
    default:
      return { lastSeenAt: sortOrder }
  }
}

export function buildPagination(
  page: number,
  limit: number,
  total: number
): UsersControlPagination {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  }
}

export function mapUsersControlSummary(
  totalUsers: number,
  onlineUsers: number,
  activeSessions: number
): UsersControlSummary {
  return {
    totalUsers,
    onlineUsers,
    activeSessions,
  }
}

export function mapUsersControlUser(
  user: UsersControlUserRecord,
  tenantId?: string
): UsersControlUserListItem {
  const scopedMembership = getScopedMembership(user.memberships, tenantId)
  const activeSessions = user.sessions.filter(
    session => session.status === UserSessionStatus.ACTIVE
  )
  const latestSession = [...user.sessions].sort(
    (left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
  )[0]
  const onlineSessions = activeSessions.filter(session =>
    isUserSessionOnline(session.lastSeenAt, session.status as UserSessionStatus)
  )

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    role: scopedMembership?.role ?? null,
    status: scopedMembership?.status ?? null,
    tenantId: scopedMembership?.tenant.id ?? null,
    tenantName: scopedMembership?.tenant.name ?? null,
    tenantCount: user.memberships.length,
    lastLoginAt: user.lastLoginAt,
    lastSeenAt: latestSession?.lastSeenAt ?? null,
    isOnline: onlineSessions.length > 0,
    activeSessionCount: activeSessions.length,
    totalSessionCount: user.sessions.length,
    sessionPlatforms: buildSessionPlatforms(user.sessions),
    isProtected: user.isProtected,
    hasGlobalAdminMembership: user.memberships.some(
      membership => membership.role === UserRole.GLOBAL_ADMIN
    ),
    mfaEnabled: user.mfaEnabled,
  }
}

export function sortUsersControlUsers(
  users: UsersControlUserListItem[],
  sortBy: UsersControlUserSortField,
  sortOrder: SortOrder
): UsersControlUserListItem[] {
  const sortedUsers = [...users]

  sortedUsers.sort((left, right) => {
    switch (sortBy) {
      case UsersControlUserSortField.EMAIL:
        return compareNullableStrings(left.email, right.email, sortOrder)
      case UsersControlUserSortField.TENANT_NAME:
        return compareNullableStrings(left.tenantName, right.tenantName, sortOrder)
      case UsersControlUserSortField.ROLE:
        return compareNullableStrings(left.role, right.role, sortOrder)
      case UsersControlUserSortField.STATUS:
        return compareNullableStrings(left.status, right.status, sortOrder)
      case UsersControlUserSortField.SESSION_PLATFORMS:
        return comparePlatformLists(left.sessionPlatforms, right.sessionPlatforms, sortOrder)
      case UsersControlUserSortField.LAST_SEEN_AT:
        return compareNullableDates(
          left.lastSeenAt ? new Date(left.lastSeenAt) : null,
          right.lastSeenAt ? new Date(right.lastSeenAt) : null,
          sortOrder
        )
      case UsersControlUserSortField.LAST_LOGIN_AT:
        return compareNullableDates(
          left.lastLoginAt ? new Date(left.lastLoginAt) : null,
          right.lastLoginAt ? new Date(right.lastLoginAt) : null,
          sortOrder
        )
      case UsersControlUserSortField.ACTIVE_SESSION_COUNT:
        return compareNumbers(left.activeSessionCount, right.activeSessionCount, sortOrder)
      case UsersControlUserSortField.CREATED_AT:
        return compareNullableDates(
          left.createdAt ? new Date(left.createdAt) : null,
          right.createdAt ? new Date(right.createdAt) : null,
          sortOrder
        )
      case UsersControlUserSortField.NAME:
      default:
        return compareNullableStrings(left.name, right.name, sortOrder)
    }
  })

  return sortedUsers
}

export function paginateUsersControlUsers(
  users: UsersControlUserListItem[],
  page: number,
  limit: number
): UsersControlUserListItem[] {
  const start = (page - 1) * limit

  return users.slice(start, start + limit)
}

export function mapUsersControlSession(
  session: UsersControlSessionRecord
): UsersControlSessionItem {
  return {
    id: session.id,
    familyId: session.familyId,
    tenantId: session.tenantId,
    tenantName: session.tenant.name,
    tenantSlug: session.tenant.slug,
    status: session.status as UsersControlSessionItem['status'],
    osFamily: session.osFamily as UsersControlSessionItem['osFamily'],
    clientType: session.clientType as UsersControlSessionItem['clientType'],
    browser: detectBrowser(session.userAgent),
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    lastSeenAt: session.lastSeenAt,
    lastLoginAt: session.lastLoginAt,
    revokedAt: session.revokedAt,
    revokeReason: session.revokeReason,
    isOnline: isUserSessionOnline(session.lastSeenAt, session.status as UserSessionStatus),
  }
}
