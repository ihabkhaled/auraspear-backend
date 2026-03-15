import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma, Notification, User, Case } from '@prisma/client'

type UserNameSelect = Pick<User, 'name'>
type UserIdNameEmailSelect = Pick<User, 'id' | 'name' | 'email'>
type CaseNumberSelect = Pick<Case, 'caseNumber'>

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyAndCount(params: {
    where: Prisma.NotificationWhereInput
    orderBy: Prisma.NotificationOrderByWithRelationInput
    skip: number
    take: number
  }): Promise<[Notification[], number]> {
    return Promise.all([
      this.prisma.notification.findMany(params),
      this.prisma.notification.count({ where: params.where }),
    ])
  }

  async countUnread(tenantId: string, recipientUserId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { tenantId, recipientUserId, readAt: null },
    })
  }

  async findFirstByIdAndRecipient(
    notificationId: string,
    tenantId: string,
    recipientUserId: string
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId, recipientUserId },
    })
  }

  async markAsRead(notificationId: string, tenantId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, tenantId },
      data: { readAt: new Date() },
    })
  }

  async markAllAsRead(tenantId: string, recipientUserId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.notification.updateMany({
      where: { tenantId, recipientUserId, readAt: null },
      data: { readAt: new Date() },
    })
  }

  async findUserById(userId: string): Promise<UserNameSelect | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })
  }

  async findUsersByIds(userIds: string[]): Promise<UserIdNameEmailSelect[]> {
    return this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    })
  }

  async createNotification(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification> {
    return this.prisma.notification.create({ data })
  }

  async createManyNotifications(
    data: Prisma.NotificationCreateManyInput[],
    skipDuplicates = true
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.notification.createMany({ data, skipDuplicates })
  }

  async findCaseById(caseId: string): Promise<CaseNumberSelect | null> {
    return this.prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true },
    })
  }
}
