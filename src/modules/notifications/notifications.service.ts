import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { NotificationsGateway } from './notifications.gateway'
import { NotificationsRepository } from './notifications.repository'
import {
  buildActorMap,
  buildMentionNotificationData,
  buildNotificationPayload,
  mapNotificationToResponse,
} from './notifications.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  NotificationEntityType,
  NotificationType,
  SortOrder,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { NotificationResponse, PaginatedNotifications } from './notifications.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

interface CreateNotificationParameters {
  tenantId: string
  type: NotificationType
  actorUserId: string
  actorEmail: string
  recipientUserId: string
  title: string
  message: string
  entityType: NotificationEntityType
  entityId: string
  caseId?: string | null
  caseCommentId?: string | null
}

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
    limit: number
  ): Promise<PaginatedNotifications> {
    const where = { tenantId, recipientUserId }
    const [notifications, total] = await this.notificationsRepository.findManyAndCount({
      where,
      orderBy: { createdAt: SortOrder.DESC },
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
      title: 'case_assigned_title',
      message: `${actorName} assigned you to case ${caseNumber}`,
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
      title: 'case_unassigned_title',
      message: `${actorName} unassigned you from case ${caseNumber}`,
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
      title: `${type}_title`,
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.TENANT_ASSIGNED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'tenant_assigned_title',
      message: `You have been added to tenant "${tenantName}" as ${role}`,
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.ROLE_CHANGED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'role_changed_title',
      message: `Your role has been changed from ${previousRole} to ${newRole}`,
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_BLOCKED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'user_blocked_title',
      message: 'Your account has been suspended by an administrator',
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_UNBLOCKED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'user_unblocked_title',
      message: 'Your account has been reactivated by an administrator',
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_REMOVED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'user_removed_title',
      message: 'Your account has been removed from this tenant',
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
    await this.createAndEmitNotification({
      tenantId,
      type: NotificationType.USER_RESTORED,
      actorUserId,
      actorEmail,
      recipientUserId: userId,
      title: 'user_restored_title',
      message: 'Your account has been restored by an administrator',
      entityType: NotificationEntityType.USER,
      entityId: userId,
    })
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
    const caseRecord = await this.notificationsRepository.findCaseById(caseId)
    const caseNumber = caseRecord?.caseNumber ?? caseId

    const notificationData = buildMentionNotificationData(
      tenantId,
      actor.sub,
      actorName,
      caseId,
      commentId,
      caseNumber,
      recipientIds,
      NotificationType.MENTION,
      NotificationEntityType.CASE_COMMENT
    )
    await this.notificationsRepository.createManyNotifications(notificationData, true)
    await this.emitMentionWebSocketEvents(
      tenantId,
      recipientIds,
      actorName,
      actor.email,
      commentId,
      caseId,
      caseNumber
    )
    this.logSuccess(
      'createMentionNotifications',
      tenantId,
      {
        caseId,
        commentId,
        recipientCount: recipientIds.length,
      },
      actor
    )
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Core Notification Creation                               */
  /* ---------------------------------------------------------------- */

  private async createAndEmitNotification(params: CreateNotificationParameters): Promise<void> {
    if (params.recipientUserId === params.actorUserId) return

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

  private async emitMentionWebSocketEvents(
    tenantId: string,
    recipientIds: string[],
    actorName: string,
    actorEmail: string,
    commentId: string,
    caseId: string,
    caseNumber: string
  ): Promise<void> {
    const unreadCounts = await Promise.all(
      recipientIds.map(id => this.getUnreadCount(tenantId, id))
    )
    for (const [index, recipientUserId] of recipientIds.entries()) {
      const payload = buildNotificationPayload(
        commentId,
        NotificationType.MENTION,
        actorName,
        actorEmail,
        'mention_notification_title',
        `${actorName} mentioned you in a comment on case ${caseNumber}`,
        NotificationEntityType.CASE_COMMENT,
        commentId,
        caseId,
        commentId
      )
      this.gateway.emitToUser(tenantId, recipientUserId, payload)
      this.gateway.emitUnreadCount(tenantId, recipientUserId, unreadCounts.at(index) ?? 0)
    }
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
