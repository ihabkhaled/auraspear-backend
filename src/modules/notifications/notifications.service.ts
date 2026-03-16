import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { NotificationsGateway } from './notifications.gateway'
import { NotificationsRepository } from './notifications.repository'
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

  async listNotifications(
    tenantId: string,
    recipientUserId: string,
    page: number,
    limit: number
  ): Promise<PaginatedNotifications> {
    const where = { tenantId, recipientUserId }
    const [notifications, total] = await this.notificationsRepository.findManyAndCount({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    })

    // Batch resolve actor names
    const actorIds = [...new Set(notifications.map(n => n.actorUserId))]
    const actors =
      actorIds.length > 0 ? await this.notificationsRepository.findUsersByIds(actorIds) : []
    const actorMap = new Map(actors.map(a => [a.id, a]))

    const data: NotificationResponse[] = notifications.map(n => {
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
    })

    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

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
    if (notification.readAt) {
      return
    }

    await this.notificationsRepository.markAsRead(notificationId, user.tenantId)
  }

  async markAllAsRead(tenantId: string, recipientUserId: string): Promise<void> {
    await this.notificationsRepository.markAllAsRead(tenantId, recipientUserId)
  }

  /**
   * Generic helper to create a single notification + emit WebSocket events.
   * Skips notification if recipientUserId === actorUserId (no self-notifications).
   */
  private async createAndEmitNotification(params: CreateNotificationParameters): Promise<void> {
    // Never notify yourself
    if (params.recipientUserId === params.actorUserId) {
      return
    }

    // Resolve actor name
    const actorUser = await this.notificationsRepository.findUserById(params.actorUserId)
    const actorName = actorUser?.name ?? params.actorEmail

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

    const unreadCount = await this.getUnreadCount(params.tenantId, params.recipientUserId)
    const payload: NotificationResponse = {
      id: params.entityId,
      type: params.type,
      actorName,
      actorEmail: params.actorEmail,
      title: params.title,
      message: params.message,
      entityType: params.entityType,
      entityId: params.entityId,
      caseId: params.caseId ?? null,
      caseCommentId: params.caseCommentId ?? null,
      isRead: false,
      createdAt: new Date(),
    }
    this.gateway.emitToUser(params.tenantId, params.recipientUserId, payload)
    this.gateway.emitUnreadCount(params.tenantId, params.recipientUserId, unreadCount)

    this.appLogger.info(`Notification created: ${params.type}`, {
      feature: AppLogFeature.NOTIFICATIONS,
      action: 'createNotification',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: params.tenantId,
      actorEmail: params.actorEmail,
      actorUserId: params.actorUserId,
      targetResource: 'Notification',
      targetResourceId: params.entityId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NotificationsService',
      functionName: 'createAndEmitNotification',
      metadata: { type: params.type, recipientUserId: params.recipientUserId },
    })
  }

  /* ---------------------------------------------------------------- */
  /* CASE ASSIGNMENT NOTIFICATIONS                                      */
  /* ---------------------------------------------------------------- */

  async notifyCaseAssigned(
    tenantId: string,
    caseId: string,
    caseNumber: string,
    assignedUserId: string,
    actorUserId: string,
    actorEmail: string
  ): Promise<void> {
    const actorUser = await this.notificationsRepository.findUserById(actorUserId)
    const actorName = actorUser?.name ?? actorEmail

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
    const actorUser = await this.notificationsRepository.findUserById(actorUserId)
    const actorName = actorUser?.name ?? actorEmail

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
  /* CASE ACTIVITY NOTIFICATIONS (to case owner)                        */
  /* ---------------------------------------------------------------- */

  /**
   * Notify the case owner about activity on their case.
   * Skips notification if the actor IS the case owner.
   */
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
    if (!ownerUserId) {
      return
    }

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
  /* TENANT / USER MANAGEMENT NOTIFICATIONS                             */
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

  async createMentionNotifications(
    tenantId: string,
    caseId: string,
    commentId: string,
    mentionedUserIds: string[],
    actor: JwtPayload
  ): Promise<void> {
    // Filter out self-mentions
    const recipientIds = mentionedUserIds.filter(id => id !== actor.sub)
    if (recipientIds.length === 0) {
      return
    }

    // Resolve actor name
    const actorUser = await this.notificationsRepository.findUserById(actor.sub)
    const actorName = actorUser?.name ?? actor.email

    // Get case number for notification message
    const caseRecord = await this.notificationsRepository.findCaseById(caseId)
    const caseNumber = caseRecord?.caseNumber ?? caseId

    const notificationData = recipientIds.map(recipientUserId => ({
      tenantId,
      type: NotificationType.MENTION,
      actorUserId: actor.sub,
      recipientUserId,
      title: 'mention_notification_title',
      message: `${actorName} mentioned you in a comment on case ${caseNumber}`,
      entityType: NotificationEntityType.CASE_COMMENT,
      entityId: commentId,
      caseId,
      caseCommentId: commentId,
    }))

    // Use skipDuplicates to handle idempotency (unique constraint on recipientUserId + caseCommentId)
    await this.notificationsRepository.createManyNotifications(notificationData, true)

    // Emit real-time WebSocket events to each recipient
    const unreadCounts = await Promise.all(
      recipientIds.map(id => this.getUnreadCount(tenantId, id))
    )
    for (const [index, recipientUserId] of recipientIds.entries()) {
      const notificationPayload: NotificationResponse = {
        id: commentId,
        type: NotificationType.MENTION,
        actorName,
        actorEmail: actor.email,
        title: 'mention_notification_title',
        message: `${actorName} mentioned you in a comment on case ${caseNumber}`,
        entityType: NotificationEntityType.CASE_COMMENT,
        entityId: commentId,
        caseId,
        caseCommentId: commentId,
        isRead: false,
        createdAt: new Date(),
      }
      this.gateway.emitToUser(tenantId, recipientUserId, notificationPayload)
      this.gateway.emitUnreadCount(tenantId, recipientUserId, unreadCounts.at(index) ?? 0)
    }

    this.appLogger.info('Mention notifications created', {
      feature: AppLogFeature.NOTIFICATIONS,
      action: 'createMentionNotifications',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor.email,
      actorUserId: actor.sub,
      targetResource: 'Notification',
      targetResourceId: commentId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NotificationsService',
      functionName: 'createMentionNotifications',
      metadata: { caseId, commentId, recipientCount: recipientIds.length },
    })
  }
}
