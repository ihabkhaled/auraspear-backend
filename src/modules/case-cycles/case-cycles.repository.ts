import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class CaseCyclesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyWithCasesAndCount(params: {
    where: Prisma.CaseCycleWhereInput
    orderBy: Prisma.CaseCycleOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return Promise.all([
      this.prisma.caseCycle.findMany({
        ...params,
        include: {
          _count: { select: { cases: true } },
          cases: { select: { status: true } },
        },
      }),
      this.prisma.caseCycle.count({ where: params.where }),
    ])
  }

  async countOrphanedCases(tenantId: string) {
    return Promise.all([
      this.prisma.case.count({ where: { tenantId, cycleId: null } }),
      this.prisma.case.count({ where: { tenantId, cycleId: null, status: { not: 'closed' } } }),
      this.prisma.case.count({ where: { tenantId, cycleId: null, status: 'closed' } }),
    ])
  }

  async findFirstActive(tenantId: string) {
    return this.prisma.caseCycle.findFirst({
      where: { tenantId, status: 'active' },
      include: {
        _count: { select: { cases: true } },
        cases: { select: { status: true } },
      },
    })
  }

  async findFirstByIdAndTenantWithCases(id: string, tenantId: string) {
    return this.prisma.caseCycle.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { cases: true } },
        cases: {
          orderBy: { createdAt: 'desc' },
          include: { tenant: { select: { name: true } } },
        },
      },
    })
  }

  async findUsersByIds(userIds: string[]) {
    return this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    })
  }

  async create(data: Prisma.CaseCycleUncheckedCreateInput) {
    return this.prisma.caseCycle.create({ data })
  }

  async findFirstByIdAndTenantWithCounts(id: string, tenantId: string) {
    return this.prisma.caseCycle.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { cases: true } },
        cases: { select: { status: true } },
      },
    })
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.caseCycle.update({
      where: { id },
      data,
    })
  }

  async activateCycleTransaction(cycleId: string, tenantId: string, closedByEmail: string) {
    return this.prisma.$transaction(async tx => {
      await tx.caseCycle.updateMany({
        where: { tenantId, status: 'active', id: { not: cycleId } },
        data: {
          status: 'closed',
          closedBy: closedByEmail,
          closedAt: new Date(),
        },
      })

      return tx.caseCycle.update({
        where: { id: cycleId },
        data: {
          status: 'active',
          closedBy: null,
          closedAt: null,
        },
      })
    })
  }

  async findFirstByIdAndTenantWithCaseCount(id: string, tenantId: string) {
    return this.prisma.caseCycle.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { cases: true } } },
    })
  }

  async deleteCycleWithCasesTransaction(cycleId: string, tenantId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.case.updateMany({
        where: { cycleId, tenantId },
        data: { cycleId: null },
      })
      await tx.caseCycle.delete({ where: { id: cycleId } })
    })
  }

  async deleteCycle(id: string) {
    return this.prisma.caseCycle.delete({ where: { id } })
  }

  async findManyForOverlapCheck(where: Prisma.CaseCycleWhereInput) {
    return this.prisma.caseCycle.findMany({
      where,
      select: { id: true, name: true, startDate: true, endDate: true },
    })
  }
}
