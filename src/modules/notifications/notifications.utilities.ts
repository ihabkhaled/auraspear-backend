import type { NotificationResponse } from './notifications.types'
import type { NotificationType, NotificationEntityType } from '../../common/enums'

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
/* MENTION NOTIFICATION DATA                                         */
/* ---------------------------------------------------------------- */

export function buildMentionNotificationData(
  tenantId: string,
  actorUserId: string,
  actorName: string,
  caseId: string,
  commentId: string,
  caseNumber: string,
  recipientIds: string[],
  type: NotificationType,
  entityType: NotificationEntityType
): Array<{
  tenantId: string
  type: NotificationType
  actorUserId: string
  recipientUserId: string
  title: string
  message: string
  entityType: NotificationEntityType
  entityId: string
  caseId: string
  caseCommentId: string
}> {
  return recipientIds.map(recipientUserId => ({
    tenantId,
    type,
    actorUserId,
    recipientUserId,
    title: 'mention_notification_title',
    message: `${actorName} mentioned you in a comment on case ${caseNumber}`,
    entityType,
    entityId: commentId,
    caseId,
    caseCommentId: commentId,
  }))
}
