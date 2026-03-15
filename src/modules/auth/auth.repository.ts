import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { MembershipStatus } from '../../common/interfaces/authenticated-request.interface'
import type { UserRole as PrismaUserRole } from '@prisma/client'

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmailWithMemberships(email: string, membershipStatus: MembershipStatus) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { status: membershipStatus },
          include: { tenant: true },
        },
      },
    })
  }

  async updateLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    })
  }

  async findUserByIdWithTenantMemberships(
    userId: string,
    tenantId: string,
    membershipStatus: MembershipStatus
  ) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { tenantId, status: membershipStatus },
          include: { tenant: true },
        },
      },
    })
  }

  async findUserByIdWithActiveMembershipCheck(userId: string, membershipStatus: MembershipStatus) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: membershipStatus },
          select: { id: true },
          take: 1,
        },
      },
    })
  }

  async findMembershipByUserAndTenant(userId: string, tenantId: string) {
    return this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
  }

  async findActiveMembershipsWithTenant(userId: string, membershipStatus: MembershipStatus) {
    return this.prisma.tenantMembership.findMany({
      where: { userId, status: membershipStatus },
      include: { tenant: true },
    })
  }

  async findUserByIdWithAllActiveMemberships(userId: string, membershipStatus: MembershipStatus) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: membershipStatus },
          include: { tenant: true },
        },
      },
    })
  }

  async upsertUserByOidcSub(oidcSub: string, email: string, name: string) {
    return this.prisma.user.upsert({
      where: { oidcSub },
      update: { email, name },
      create: { oidcSub, email, name },
    })
  }

  async upsertTenantMembership(userId: string, tenantId: string, defaultRole: PrismaUserRole) {
    return this.prisma.tenantMembership.upsert({
      where: { userId_tenantId: { userId, tenantId } },
      update: {},
      create: { userId, tenantId, role: defaultRole },
    })
  }
}
