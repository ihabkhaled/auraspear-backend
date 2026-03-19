import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { PermissionUpdateReason } from './notifications.enums'
import { NotificationsGateway } from './notifications.gateway'
import { NotificationsRepository } from './notifications.repository'
import {
  buildActorMap,
  buildNotificationOrderBy,
  buildNotificationPayload,
  buildNotificationWhereClause,
  getNotificationTitle,
  isNotificationAllowedByPreference,
  mapNotificationToResponse,
} from './notifications.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  NotificationEntityType,
  NotificationType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  CreateNotificationParameters,
  NotificationResponse,
  PaginatedNotifications,
} from './notifications.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly appLogger: AppLoggerService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST                                                              */
  /* ---------------------------------------------------------------- */

  async listNotifications(
    tenantId: string,
    recipientUserId: string,
    page: number,
    limit: number,
    sortBy?: string,
    sortOrder?: string,
    query?: string,
    type?: string,
    isRead?: string
  ): Promise<PaginatedNotifications> {
    const where = buildNotificationWhereClause(tenantId, recipientUserId, {
      query,
      type: type as NotificationType | undefined,
      isRead,
    })
    const orderBy = buildNotificationOrderBy(sortBy, sortOrder)
    const [notifications, total] = await this.notificationsRepository.findManyAndCount({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    })

    const actorIds = [...new Set(notifications.map(n => n.actorUserId))]
    const actors =
      actorIds.length > 0 ? await this.notificationsRepository.findUsersByIds(actorIds) : []
    const actorMap = buildActorMap(actors)
    const data = notifications.map(n => mapNotificationToResponse(n, actorMap))
    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  /* ---------------------------------------------------------------- */
  /* UNREAD COUNT / READ                                               */
  /* ---------------------------------------------------------------- */

  async getUnreadCount(tenantId: string, recipientUserId: string): Promise<number> {
    return this.notificationsRepository.countUnread(tenantId, recipientUserId)
  }

  async markAsRead(notificationId: string, user: JwtPayload): Promise<void> {
    const notification = await this.notificationsRepository.findFirstByIdAndRecipient(
      notificationId,
      user.tenantId,
      user.sub
    )
    if (!notification) {
      throw new BusinessException(404, 'Notification not found', 'errors.notifications.notFound')
    }
    if (notification.readAt) return
    await this.notificationsRepository.markAsRead(notificationId, user.tenantId)
  }

  async markAllAsRead(tenantId: string, recipientUserId: string): Promise<void> {
    await this.notificationsRepository.markAllAsRead(tenantId, recipientUserId)
  }

  /* ---------------------------------------------------------------- */
  /* CASE ASSIGNMENT NOTIFICATIONS                                     */
  /* ---------------------------------------------------------------- */

  async notifyCaseAssigned(
    tenantId: string,
    caseId: string,
    caseNumber: string,
    assignedUserId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.CASE_ASSIGNED,
      actorUserId,
      actorEmail,
      recipientUserId: assignedUserId,
      title: getNotificationTitle(NotificationType.CASE_ASSIGNED),
      message: JSON.stringify({
        key: 'caseAssignedMessage',
        params: { actorName, caseRef: caseNumber },
      }),
      entityType: NotificationEntityType.CASE,
      entityId: caseId,
      caseId,
    })
  }

  async notifyCaseUnassigned(
    tenantId: string,
    caseId: string,
    caseNumber: string,
    previousOwnerId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.CASE_UNASSIGNED,
      actorUserId,
      actorEmail,
      recipientUserId: previousOwnerId,
      title: getNotificationTitle(NotificationType.CASE_UNASSIGNED),
      message: JSON.stringify({
        key: 'caseUnassignedMessage',
        params: { actorName, caseRef: caseNumber },
      }),
      entityType: NotificationEntityType.CASE,
      entityId: caseId,
      caseId,
    })
  }

  /* ---------------------------------------------------------------- */
  /* CASE ACTIVITY NOTIFICATIONS                                       */
  /* ---------------------------------------------------------------- */

  async notifyCaseActivity(
    tenantId: string,
    caseId: string,
    caseNumber: string,
    ownerUserId: string | null,
    type: NotificationType,
    message: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    if (!ownerUserId) return
    await this.createAndEmitNotification({
      tenantId,
      type,
      actorUserId,
      actorEmail,
      recipientUserId: ownerUserId,
      title: getNotificationTitle(type),
      message,
      entityType: NotificationEntityType.CASE,
      entityId: caseId,
      caseId,
    })
  }

  /* ---------------------------------------------------------------- */
  /* TENANT / USER MANAGEMENT NOTIFICATIONS                            */
  /* ---------------------------------------------------------------- */

  async notifyTenantAssigned(
    tenantId: string,
    userId: string,
    tenantName: string,
    role: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.TENANT_ASSIGNED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.TENANT_ASSIGNED),
      message: JSON.stringify({ key: 'tenantAssignedMessage', params: { actorName } }),
      entityType: NotificationEntityType.TENANT,
      entityId: tenantId,
    })
  }

  async notifyRoleChanged(
    tenantId: string,
    userId: string,
    previousRole: string,
    newRole: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.ROLE_CHANGED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.ROLE_CHANGED),
      message: JSON.stringify({ key: 'roleChangedMessage', params: { actorName, role: newRole } }),
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
  }

  async notifyUserBlocked(
    tenantId: string,
    userId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_BLOCKED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.USER_BLOCKED),
      message: JSON.stringify({ key: 'userBlockedMessage', params: { actorName } }),
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
  }

  async notifyUserUnblocked(
    tenantId: string,
    userId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_UNBLOCKED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.USER_UNBLOCKED),
      message: JSON.stringify({ key: 'userUnblockedMessage', params: { actorName } }),
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
  }

  async notifyUserRemoved(
    tenantId: string,
    userId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_REMOVED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.USER_REMOVED),
      message: JSON.stringify({ key: 'userRemovedMessage', params: { actorName } }),
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
  }

  async notifyUserRestored(
    tenantId: string,
    userId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorName = await this.resolveActorName(actorUserId, actorEmail)
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_RESTORED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: getNotificationTitle(NotificationType.USER_RESTORED),
      message: JSON.stringify({ key: 'userRestoredMessage', params: { actorName } }),
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
  }

  emitPermissionsUpdated(tenantId: string, userId: string, reason: PermissionUpdateReason): void {
    this.gateway.emitPermissionsUpdated(tenantId, userId, reason)
  }

  emitPermissionsUpdatedToUsers(
    tenantId: string,
    userIds: string[],
    reason: PermissionUpdateReason
  ): void {
    const uniqueUserIds = [...new Set(userIds.filter(userId => userId.trim().length > 0))]

    for (const userId of uniqueUserIds) {
      this.gateway.emitPermissionsUpdated(tenantId, userId, reason)
    }
  }

  /* ---------------------------------------------------------------- */
  /* MENTION NOTIFICATIONS                                             */
  /* ---------------------------------------------------------------- */

  async createMentionNotifications(
    tenantId: string,
    caseId: string,
    commentId: string,
    mentionedUserIds: string[],
    actor: JwtPayload
  ): Promise<void> {
    const recipientIds = mentionedUserIds.filter(id => id !== actor.sub)
    if (recipientIds.length === 0) return

    const actorName = await this.resolveActorName(actor.sub, actor.email)
    const caseRecord = await this.notificationsRepository.findCaseById(caseId, tenantId)
    const caseNumber = caseRecord?.caseNumber ?? caseId

    await Promise.all(
      recipientIds.map(async recipientUserId =>
        this.createAndEmitNotification({
          tenantId,
          type: NotificationType.MENTION,
          actorUserId: actor.sub,
          actorEmail: actor.email,
          recipientUserId,
          title: getNotificationTitle(NotificationType.MENTION),
          message: JSON.stringify({
            key: 'mentionMessage',
            params: { actorName, caseRef: caseNumber },
          }),
          entityType: NotificationEntityType.CASE_COMMENT,
          entityId: commentId,
          caseId,
          caseCommentId: commentId,
        })
      )
    )
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Core Notification Creation                               */
  /* ---------------------------------------------------------------- */

  private async createAndEmitNotification(params: CreateNotificationParameters): Promise<void> {
    if (params.recipientUserId === params.actorUserId) return

    const preferences = await this.notificationsRepository.findUserPreference(
      params.recipientUserId
    )
    if (!isNotificationAllowedByPreference(preferences, params.type)) {
      this.appLogger.info('Notification suppressed by user preference', {
        feature: AppLogFeature.NOTIFICATIONS,
        action: 'createNotification',
        outcome: AppLogOutcome.SUCCESS,
        tenantId: params.tenantId,
        actorEmail: params.actorEmail,
        actorUserId: params.actorUserId,
        targetResource: 'Notification',
        sourceType: AppLogSourceType.SERVICE,
        className: 'NotificationsService',
        functionName: 'createAndEmitNotification',
        metadata: {
          type: params.type,
          recipientUserId: params.recipientUserId,
          reason: 'user_preference_disabled',
        },
      })
      return
    }

    const actorName = await this.resolveActorName(params.actorUserId, params.actorEmail)
    await this.notificationsRepository.createNotification({
      tenantId: params.tenantId,
      type: params.type,
      actorUserId: params.actorUserId,
      recipientUserId: params.recipientUserId,
      title: params.title,
      message: params.message,
      entityType: params.entityType,
      entityId: params.entityId,
      caseId: params.caseId ?? null,
      caseCommentId: params.caseCommentId ?? null,
    })

    const payload = buildNotificationPayload(
      params.entityId,
      params.type,
      actorName,
      params.actorEmail,
      params.title,
      params.message,
      params.entityType,
      params.entityId,
      params.caseId ?? null,
      params.caseCommentId ?? null
    )
    await this.emitToRecipient(params.tenantId, params.recipientUserId, payload)
    this.logSuccess(
      'createNotification',
      params.tenantId,
      {
        type: params.type,
        recipientUserId: params.recipientUserId,
      },
      { sub: params.actorUserId, email: params.actorEmail } as JwtPayload
    )
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: WebSocket Emission                                       */
  /* ---------------------------------------------------------------- */

  private async emitToRecipient(
    tenantId: string,
    recipientUserId: string,
    payload: NotificationResponse
  ): Promise<void> {
    const unreadCount = await this.getUnreadCount(tenantId, recipientUserId)
    this.gateway.emitToUser(tenantId, recipientUserId, payload)
    this.gateway.emitUnreadCount(tenantId, recipientUserId, unreadCount)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                  */
  /* ---------------------------------------------------------------- */

  private async resolveActorName(actorUserId: string, fallbackEmail: string): Promise<string> {
    const user = await this.notificationsRepository.findUserById(actorUserId)
    return user?.name ?? fallbackEmail
  }

  private logSuccess(
    action: string,
    tenantId: string,
    metadata?: Record<string, unknown>,
    actor?: JwtPayload
  ): void {
    this.appLogger.info(`Notification ${action}`, {
      feature: AppLogFeature.NOTIFICATIONS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor?.email,
      actorUserId: actor?.sub,
      targetResource: 'Notification',
      sourceType: AppLogSourceType.SERVICE,
      className: 'NotificationsService',
      functionName: action,
      metadata,
    })
  }
}
