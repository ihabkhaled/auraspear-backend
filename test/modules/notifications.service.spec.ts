import { NotificationType, NotificationEntityType } from '../../src/common/enums'
import { BusinessException } from '../../src/common/exceptions/business.exception'
import { NotificationsService } from '../../src/modules/notifications/notifications.service'

const TENANT_ID = 'tenant-001'
const ACTOR_ID = 'actor-001'
const ACTOR_EMAIL = 'admin@auraspear.com'
const ACTOR_NAME = 'Admin User'
const RECIPIENT_ID = 'recipient-001'
const CASE_ID = 'case-001'
const CASE_NUMBER = 'SOC-2026-001'
const COMMENT_ID = 'comment-001'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const mockGateway = {
  emitToUser: jest.fn(),
  emitUnreadCount: jest.fn(),
}

function createMockPrisma() {
  return {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'notif-001' }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ name: ACTOR_NAME }),
    },
    case: {
      findUnique: jest.fn().mockResolvedValue({ caseNumber: CASE_NUMBER }),
    },
  }
}

const mockUser = {
  sub: ACTOR_ID,
  email: ACTOR_EMAIL,
  tenantId: TENANT_ID,
  tenantSlug: 'auraspear',
  role: 'TENANT_ADMIN' as const,
}

describe('NotificationsService', () => {
  let service: NotificationsService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createMockPrisma()
    service = new NotificationsService(
      prisma as never,
      mockAppLogger as never,
      mockGateway as never
    )
  })

  /* ------------------------------------------------------------------ */
  /* listNotifications                                                     */
  /* ------------------------------------------------------------------ */

  describe('listNotifications', () => {
    it('should return paginated notifications with resolved actor names', async () => {
      const now = new Date()
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          tenantId: TENANT_ID,
          type: 'mention',
          actorUserId: ACTOR_ID,
          recipientUserId: RECIPIENT_ID,
          title: 'mention_notification_title',
          message: 'Admin mentioned you',
          entityType: 'case_comment',
          entityId: COMMENT_ID,
          caseId: CASE_ID,
          caseCommentId: COMMENT_ID,
          readAt: null,
          createdAt: now,
        },
      ])
      prisma.notification.count.mockResolvedValue(1)
      prisma.user.findMany.mockResolvedValue([
        { id: ACTOR_ID, name: ACTOR_NAME, email: ACTOR_EMAIL },
      ])

      const result = await service.listNotifications(TENANT_ID, RECIPIENT_ID, 1, 10)

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        id: 'notif-1',
        type: 'mention',
        actorName: ACTOR_NAME,
        actorEmail: ACTOR_EMAIL,
        isRead: false,
      })
      expect(result.pagination).toMatchObject({ page: 1, limit: 10, total: 1 })
    })

    it('should return "Unknown" for unresolvable actor', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          actorUserId: 'deleted-user',
          recipientUserId: RECIPIENT_ID,
          type: 'mention',
          title: 'test',
          message: 'test',
          entityType: 'case_comment',
          entityId: 'e-1',
          caseId: null,
          caseCommentId: null,
          readAt: null,
          createdAt: new Date(),
        },
      ])
      prisma.notification.count.mockResolvedValue(1)
      prisma.user.findMany.mockResolvedValue([])

      const result = await service.listNotifications(TENANT_ID, RECIPIENT_ID, 1, 10)

      expect(result.data[0]?.actorName).toBe('Unknown')
      expect(result.data[0]?.actorEmail).toBe('')
    })

    it('should mark notification as read when readAt is set', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          actorUserId: ACTOR_ID,
          recipientUserId: RECIPIENT_ID,
          type: 'mention',
          title: 'test',
          message: 'test',
          entityType: 'case_comment',
          entityId: 'e-1',
          caseId: null,
          caseCommentId: null,
          readAt: new Date(),
          createdAt: new Date(),
        },
      ])
      prisma.notification.count.mockResolvedValue(1)
      prisma.user.findMany.mockResolvedValue([{ id: ACTOR_ID, name: 'A', email: 'a@b.com' }])

      const result = await service.listNotifications(TENANT_ID, RECIPIENT_ID, 1, 10)

      expect(result.data[0]?.isRead).toBe(true)
    })
  })

  /* ------------------------------------------------------------------ */
  /* getUnreadCount                                                        */
  /* ------------------------------------------------------------------ */

  describe('getUnreadCount', () => {
    it('should return unread count from prisma', async () => {
      prisma.notification.count.mockResolvedValue(5)

      const count = await service.getUnreadCount(TENANT_ID, RECIPIENT_ID)

      expect(count).toBe(5)
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, recipientUserId: RECIPIENT_ID, readAt: null },
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* markAsRead                                                            */
  /* ------------------------------------------------------------------ */

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        readAt: null,
      })

      await service.markAsRead('notif-1', mockUser)

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { readAt: expect.any(Date) },
      })
    })

    it('should throw 404 if notification not found', async () => {
      prisma.notification.findFirst.mockResolvedValue(null)

      await expect(service.markAsRead('notif-999', mockUser)).rejects.toThrow(BusinessException)
      await expect(service.markAsRead('notif-999', mockUser)).rejects.toThrow(
        'Notification not found'
      )
    })

    it('should skip update if already read', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        readAt: new Date(),
      })

      await service.markAsRead('notif-1', mockUser)

      expect(prisma.notification.update).not.toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* markAllAsRead                                                         */
  /* ------------------------------------------------------------------ */

  describe('markAllAsRead', () => {
    it('should update all unread notifications', async () => {
      await service.markAllAsRead(TENANT_ID, RECIPIENT_ID)

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, recipientUserId: RECIPIENT_ID, readAt: null },
        data: { readAt: expect.any(Date) },
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyCaseAssigned                                                    */
  /* ------------------------------------------------------------------ */

  describe('notifyCaseAssigned', () => {
    it('should create notification and emit WebSocket events', async () => {
      await service.notifyCaseAssigned(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        RECIPIENT_ID,
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          type: NotificationType.CASE_ASSIGNED,
          actorUserId: ACTOR_ID,
          recipientUserId: RECIPIENT_ID,
          caseId: CASE_ID,
        }),
      })
      expect(mockGateway.emitToUser).toHaveBeenCalledWith(
        TENANT_ID,
        RECIPIENT_ID,
        expect.objectContaining({ type: NotificationType.CASE_ASSIGNED })
      )
      expect(mockGateway.emitUnreadCount).toHaveBeenCalledWith(TENANT_ID, RECIPIENT_ID, 0)
    })

    it('should skip notification if actor is the assignee (self-assign)', async () => {
      await service.notifyCaseAssigned(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        ACTOR_ID,
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(mockGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('should include actor name in message', async () => {
      prisma.user.findUnique.mockResolvedValue({ name: 'Jane Admin' })

      await service.notifyCaseAssigned(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        RECIPIENT_ID,
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: `Jane Admin assigned you to case ${CASE_NUMBER}`,
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyCaseUnassigned                                                  */
  /* ------------------------------------------------------------------ */

  describe('notifyCaseUnassigned', () => {
    it('should create unassign notification', async () => {
      await service.notifyCaseUnassigned(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        RECIPIENT_ID,
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.CASE_UNASSIGNED,
          recipientUserId: RECIPIENT_ID,
        }),
      })
      expect(mockGateway.emitToUser).toHaveBeenCalled()
    })

    it('should skip if actor is the previous owner', async () => {
      await service.notifyCaseUnassigned(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        ACTOR_ID,
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).not.toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyCaseActivity                                                    */
  /* ------------------------------------------------------------------ */

  describe('notifyCaseActivity', () => {
    it('should notify case owner about activity', async () => {
      await service.notifyCaseActivity(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        RECIPIENT_ID,
        NotificationType.CASE_COMMENT_ADDED,
        'New comment on case SOC-2026-001',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.CASE_COMMENT_ADDED,
          recipientUserId: RECIPIENT_ID,
          entityType: NotificationEntityType.CASE,
          entityId: CASE_ID,
          caseId: CASE_ID,
        }),
      })
      expect(mockGateway.emitToUser).toHaveBeenCalled()
    })

    it('should skip if ownerUserId is null (unassigned case)', async () => {
      await service.notifyCaseActivity(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        null,
        NotificationType.CASE_TASK_ADDED,
        'New task added',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(mockGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('should skip if actor is the case owner', async () => {
      await service.notifyCaseActivity(
        TENANT_ID,
        CASE_ID,
        CASE_NUMBER,
        ACTOR_ID,
        NotificationType.CASE_ARTIFACT_ADDED,
        'Artifact added',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('should handle all case activity types', async () => {
      const types = [
        NotificationType.CASE_COMMENT_ADDED,
        NotificationType.CASE_TASK_ADDED,
        NotificationType.CASE_ARTIFACT_ADDED,
        NotificationType.CASE_STATUS_CHANGED,
        NotificationType.CASE_UPDATED,
      ]

      for (const type of types) {
        jest.clearAllMocks()
        prisma.notification.count.mockResolvedValue(0)
        prisma.user.findUnique.mockResolvedValue({ name: ACTOR_NAME })
        prisma.notification.create.mockResolvedValue({ id: 'n-1' })

        await service.notifyCaseActivity(
          TENANT_ID,
          CASE_ID,
          CASE_NUMBER,
          RECIPIENT_ID,
          type,
          `Message for ${type}`,
          ACTOR_ID,
          ACTOR_EMAIL
        )

        expect(prisma.notification.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ type }),
        })
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyTenantAssigned                                                  */
  /* ------------------------------------------------------------------ */

  describe('notifyTenantAssigned', () => {
    it('should create tenant assignment notification', async () => {
      await service.notifyTenantAssigned(
        TENANT_ID,
        RECIPIENT_ID,
        'AuraSpear',
        'SOC_ANALYST_L1',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.TENANT_ASSIGNED,
          recipientUserId: RECIPIENT_ID,
          entityType: NotificationEntityType.TENANT,
          entityId: TENANT_ID,
          message: 'You have been added to tenant "AuraSpear" as SOC_ANALYST_L1',
        }),
      })
      expect(mockGateway.emitToUser).toHaveBeenCalled()
    })

    it('should skip self-notification', async () => {
      await service.notifyTenantAssigned(
        TENANT_ID,
        ACTOR_ID,
        'AuraSpear',
        'TENANT_ADMIN',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).not.toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyRoleChanged                                                     */
  /* ------------------------------------------------------------------ */

  describe('notifyRoleChanged', () => {
    it('should create role change notification', async () => {
      await service.notifyRoleChanged(
        TENANT_ID,
        RECIPIENT_ID,
        'SOC_ANALYST_L1',
        'TENANT_ADMIN',
        ACTOR_ID,
        ACTOR_EMAIL
      )

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.ROLE_CHANGED,
          recipientUserId: RECIPIENT_ID,
          entityType: NotificationEntityType.USER,
          message: 'Your role has been changed from SOC_ANALYST_L1 to TENANT_ADMIN',
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyUserBlocked                                                     */
  /* ------------------------------------------------------------------ */

  describe('notifyUserBlocked', () => {
    it('should create blocked notification', async () => {
      await service.notifyUserBlocked(TENANT_ID, RECIPIENT_ID, ACTOR_ID, ACTOR_EMAIL)

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.USER_BLOCKED,
          recipientUserId: RECIPIENT_ID,
          message: 'Your account has been suspended by an administrator',
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyUserUnblocked                                                   */
  /* ------------------------------------------------------------------ */

  describe('notifyUserUnblocked', () => {
    it('should create unblocked notification', async () => {
      await service.notifyUserUnblocked(TENANT_ID, RECIPIENT_ID, ACTOR_ID, ACTOR_EMAIL)

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.USER_UNBLOCKED,
          message: 'Your account has been reactivated by an administrator',
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyUserRemoved                                                     */
  /* ------------------------------------------------------------------ */

  describe('notifyUserRemoved', () => {
    it('should create removed notification', async () => {
      await service.notifyUserRemoved(TENANT_ID, RECIPIENT_ID, ACTOR_ID, ACTOR_EMAIL)

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.USER_REMOVED,
          message: 'Your account has been removed from this tenant',
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* notifyUserRestored                                                    */
  /* ------------------------------------------------------------------ */

  describe('notifyUserRestored', () => {
    it('should create restored notification', async () => {
      await service.notifyUserRestored(TENANT_ID, RECIPIENT_ID, ACTOR_ID, ACTOR_EMAIL)

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.USER_RESTORED,
          message: 'Your account has been restored by an administrator',
        }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* createMentionNotifications                                            */
  /* ------------------------------------------------------------------ */

  describe('createMentionNotifications', () => {
    it('should create notifications for mentioned users', async () => {
      prisma.notification.count.mockResolvedValue(3)

      await service.createMentionNotifications(
        TENANT_ID,
        CASE_ID,
        COMMENT_ID,
        [RECIPIENT_ID, 'user-002'],
        mockUser
      )

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            recipientUserId: RECIPIENT_ID,
            type: 'mention',
            caseId: CASE_ID,
            caseCommentId: COMMENT_ID,
          }),
          expect.objectContaining({
            recipientUserId: 'user-002',
          }),
        ]),
        skipDuplicates: true,
      })
      expect(mockGateway.emitToUser).toHaveBeenCalledTimes(2)
      expect(mockGateway.emitUnreadCount).toHaveBeenCalledTimes(2)
    })

    it('should filter out self-mentions', async () => {
      await service.createMentionNotifications(TENANT_ID, CASE_ID, COMMENT_ID, [ACTOR_ID], mockUser)

      expect(prisma.notification.createMany).not.toHaveBeenCalled()
      expect(mockGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('should skip when no recipients after filtering', async () => {
      await service.createMentionNotifications(TENANT_ID, CASE_ID, COMMENT_ID, [], mockUser)

      expect(prisma.notification.createMany).not.toHaveBeenCalled()
    })

    it('should use actor email as fallback name', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.notification.count.mockResolvedValue(1)

      await service.createMentionNotifications(
        TENANT_ID,
        CASE_ID,
        COMMENT_ID,
        [RECIPIENT_ID],
        mockUser
      )

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(ACTOR_EMAIL),
          }),
        ]),
        skipDuplicates: true,
      })
    })

    it('should use caseId as fallback when case not found', async () => {
      prisma.case.findUnique.mockResolvedValue(null)
      prisma.notification.count.mockResolvedValue(0)

      await service.createMentionNotifications(
        TENANT_ID,
        CASE_ID,
        COMMENT_ID,
        [RECIPIENT_ID],
        mockUser
      )

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(CASE_ID),
          }),
        ]),
        skipDuplicates: true,
      })
    })
  })
})
