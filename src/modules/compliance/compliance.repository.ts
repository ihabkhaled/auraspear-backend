import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class ComplianceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* FRAMEWORK QUERIES                                                  */
  /* ---------------------------------------------------------------- */

  async findManyFrameworks(params: {
    where: Prisma.ComplianceFrameworkWhereInput
    skip: number
    take: number
    orderBy: Prisma.ComplianceFrameworkOrderByWithRelationInput
  }) {
    return this.prisma.complianceFramework.findMany(params)
  }

  async findManyFrameworksWithTenant(params: {
    where: Prisma.ComplianceFrameworkWhereInput
    skip: number
    take: number
    orderBy: Prisma.ComplianceFrameworkOrderByWithRelationInput
  }) {
    return this.prisma.complianceFramework.findMany({
      ...params,
      include: { tenant: { select: { name: true } } },
    })
  }

  async countFrameworks(where: Prisma.ComplianceFrameworkWhereInput): Promise<number> {
    return this.prisma.complianceFramework.count({ where })
  }

  async findFirstFramework(where: Prisma.ComplianceFrameworkWhereInput) {
    return this.prisma.complianceFramework.findFirst({ where })
  }

  async findFirstFrameworkWithTenant(where: Prisma.ComplianceFrameworkWhereInput) {
    return this.prisma.complianceFramework.findFirst({
      where,
      include: { tenant: { select: { name: true } } },
    })
  }

  async createFramework(data: Prisma.ComplianceFrameworkUncheckedCreateInput) {
    return this.prisma.complianceFramework.create({
      data,
      include: { tenant: { select: { name: true } } },
    })
  }

  async updateManyFrameworks(params: {
    where: Prisma.ComplianceFrameworkWhereInput
    data: Prisma.ComplianceFrameworkUpdateManyMutationInput | Record<string, unknown>
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.complianceFramework.updateMany(params)
  }

  async deleteFrameworkWithControls(id: string, tenantId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.complianceControl.deleteMany({
        where: {
          frameworkId: id,
          framework: { tenantId },
        },
      })
      await tx.complianceFramework.deleteMany({
        where: { id, tenantId },
      })
    })
  }

  /* ---------------------------------------------------------------- */
  /* CONTROL QUERIES                                                    */
  /* ---------------------------------------------------------------- */

  async groupByControls(params: {
    by: ['frameworkId', 'status']
    where: Prisma.ComplianceControlWhereInput
    _count: { id: true }
  }) {
    return this.prisma.complianceControl.groupBy(params)
  }

  async findManyControls(params: {
    where: Prisma.ComplianceControlWhereInput
    orderBy: Prisma.ComplianceControlOrderByWithRelationInput
  }) {
    return this.prisma.complianceControl.findMany(params)
  }

  async findFirstControl(params: { where: Prisma.ComplianceControlWhereInput }) {
    return this.prisma.complianceControl.findFirst(params)
  }

  async createControl(data: Prisma.ComplianceControlUncheckedCreateInput) {
    return this.prisma.complianceControl.create({ data })
  }

  async updateManyControls(params: {
    where: Prisma.ComplianceControlWhereInput
    data: Record<string, unknown>
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.complianceControl.updateMany(params)
  }

  async findControlByIdAndTenant(controlId: string, tenantId: string) {
    return this.prisma.complianceControl.findFirst({
      where: {
        id: controlId,
        framework: { tenantId },
      },
    })
  }

  async groupByControlStatus(where: Prisma.ComplianceControlWhereInput) {
    return this.prisma.complianceControl.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    })
  }

  /* ---------------------------------------------------------------- */
  /* USER RESOLUTION                                                    */
  /* ---------------------------------------------------------------- */

  async findUserByEmail(email: string): Promise<{ name: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { name: true },
    })
  }

  async findUsersByEmails(emails: string[]): Promise<{ email: string; name: string }[]> {
    return this.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, name: true },
    })
  }
}
