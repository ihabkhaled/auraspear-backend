import { NotificationType } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { NotificationPreferenceSelect } from './notifications.repository'
import type { NotificationResponse } from './notifications.types'
import type { NotificationEntityType } from '../../common/enums'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* NOTIFICATION TITLE MAP                                            */
/* ---------------------------------------------------------------- */

const NOTIFICATION_TITLE_MAP: Record<NotificationType, string> = {
  [NotificationType.CASE_ASSIGNED]: 'Case Assigned',
  [NotificationType.CASE_UNASSIGNED]: 'Case Unassigned',
  [NotificationType.CASE_COMMENT_ADDED]: 'Comment Added',
  [NotificationType.CASE_TASK_ADDED]: 'Task Added',
  [NotificationType.CASE_ARTIFACT_ADDED]: 'Artifact Added',
  [NotificationType.CASE_STATUS_CHANGED]: 'Status Changed',
  [NotificationType.CASE_UPDATED]: 'Case Updated',
  [NotificationType.MENTION]: 'Mentioned in Comment',
  [NotificationType.TENANT_ASSIGNED]: 'Added to Tenant',
  [NotificationType.ROLE_CHANGED]: 'Role Changed',
  [NotificationType.USER_BLOCKED]: 'Account Suspended',
  [NotificationType.USER_UNBLOCKED]: 'Account Reactivated',
  [NotificationType.USER_REMOVED]: 'Removed from Tenant',
  [NotificationType.USER_RESTORED]: 'Account Restored',
}

export function getNotificationTitle(type: NotificationType): string {
  return NOTIFICATION_TITLE_MAP[type]
}

/* ---------------------------------------------------------------- */
/* NOTIFICATION RESPONSE MAPPING                                     */
/* ---------------------------------------------------------------- */

interface NotificationRow {
  id: string
  type: string
  actorUserId: string
  title: string
  message: string
  entityType: string
  entityId: string
  caseId: string | null
  caseCommentId: string | null
  readAt: Date | null
  createdAt: Date
}

export function mapNotificationToResponse(
  n: NotificationRow,
  actorMap: Map<string, { name: string; email: string }>
): NotificationResponse {
  const actor = actorMap.get(n.actorUserId)
  return {
    id: n.id,
    type: n.type,
    actorName: actor?.name ?? 'Unknown',
    actorEmail: actor?.email ?? '',
    title: n.title,
    message: n.message,
    entityType: n.entityType,
    entityId: n.entityId,
    caseId: n.caseId,
    caseCommentId: n.caseCommentId,
    isRead: n.readAt !== null,
    createdAt: n.createdAt,
  }
}

export function buildActorMap(
  actors: Array<{ id: string; name: string; email: string }>
): Map<string, { name: string; email: string }> {
  return new Map(actors.map(a => [a.id, { name: a.name, email: a.email }]))
}

/* ---------------------------------------------------------------- */
/* NOTIFICATION PAYLOAD                                              */
/* ---------------------------------------------------------------- */

export function buildNotificationPayload(
  id: string,
  type: NotificationType,
  actorName: string,
  actorEmail: string,
  title: string,
  message: string,
  entityType: NotificationEntityType,
  entityId: string,
  caseId: string | null,
  caseCommentId: string | null
): NotificationResponse {
  return {
    id,
    type,
    actorName,
    actorEmail,
    title,
    message,
    entityType,
    entityId,
    caseId,
    caseCommentId,
    isRead: false,
    createdAt: new Date(),
  }
}

/* ---------------------------------------------------------------- */
/* NOTIFICATION LIST QUERY BUILDERS                                  */
/* ---------------------------------------------------------------- */

export function buildNotificationWhereClause(
  tenantId: string,
  recipientUserId: string,
  filters: {
    query?: string
    type?: string
    isRead?: string
  }
): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = { tenantId, recipientUserId }

  if (filters.type) {
    where.type = filters.type
  }

  if (filters.isRead === 'true') {
    where.readAt = { not: null }
  } else if (filters.isRead === 'false') {
    where.readAt = null
  }

  if (filters.query && filters.query.trim().length > 0) {
    where.OR = [
      { title: { contains: filters.query, mode: 'insensitive' } },
      { message: { contains: filters.query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildNotificationOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.NotificationOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'type':
      return { type: order }
    case 'title':
      return { title: order }
    case 'isRead':
      return { readAt: order }
    default:
      return { createdAt: order }
  }
}

/* ---------------------------------------------------------------- */
/* NOTIFICATION PREFERENCE CHECK                                     */
/* ---------------------------------------------------------------- */

type PreferenceField = keyof Omit<NotificationPreferenceSelect, 'notificationsInApp'>

const NOTIFICATION_TYPE_TO_PREFERENCE = new Map<NotificationType, PreferenceField>([
  [NotificationType.CASE_ASSIGNED, 'notifyCaseAssignments'],
  [NotificationType.CASE_UNASSIGNED, 'notifyCaseAssignments'],
  [NotificationType.CASE_COMMENT_ADDED, 'notifyCaseComments'],
  [NotificationType.CASE_TASK_ADDED, 'notifyCaseActivity'],
  [NotificationType.CASE_ARTIFACT_ADDED, 'notifyCaseActivity'],
  [NotificationType.CASE_STATUS_CHANGED, 'notifyCaseActivity'],
  [NotificationType.CASE_UPDATED, 'notifyCaseUpdates'],
  [NotificationType.MENTION, 'notifyCaseComments'],
  [NotificationType.TENANT_ASSIGNED, 'notifyUserManagement'],
  [NotificationType.ROLE_CHANGED, 'notifyUserManagement'],
  [NotificationType.USER_BLOCKED, 'notifyUserManagement'],
  [NotificationType.USER_UNBLOCKED, 'notifyUserManagement'],
  [NotificationType.USER_REMOVED, 'notifyUserManagement'],
  [NotificationType.USER_RESTORED, 'notifyUserManagement'],
])

/**
 * Checks whether a notification should be sent based on user preferences.
 * Returns `true` if the notification is allowed, `false` if suppressed.
 *
 * When no preferences exist (new user, no row yet), defaults to allowing notifications.
 */
export function isNotificationAllowedByPreference(
  preferences: NotificationPreferenceSelect | null,
  notificationType: NotificationType
): boolean {
  // No preference record means defaults apply (all enabled)
  if (preferences === null) return true

  // Global in-app toggle must be enabled
  if (!preferences.notificationsInApp) return false

  // Check category-specific preference
  const preferenceField = NOTIFICATION_TYPE_TO_PREFERENCE.get(notificationType)
  if (preferenceField === undefined) return true

  return preferences[preferenceField]
}
