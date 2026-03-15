import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma, Report, User } from '@prisma/client'

type ReportWithTenant = Report & { tenant: { name: string } }

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyReports(params: {
    where: Prisma.ReportWhereInput
    skip: number
    take: number
    orderBy: Prisma.ReportOrderByWithRelationInput
    include?: Prisma.ReportInclude
  }): Promise<ReportWithTenant[]> {
    return this.prisma.report.findMany(params) as Promise<ReportWithTenant[]>
  }

  async countReports(where: Prisma.ReportWhereInput): Promise<number> {
    return this.prisma.report.count({ where })
  }

  async findFirstReport(params: {
    where: Prisma.ReportWhereInput
    include?: Prisma.ReportInclude
  }): Promise<ReportWithTenant | null> {
    return this.prisma.report.findFirst(params) as Promise<ReportWithTenant | null>
  }

  async createReport(params: {
    data: Prisma.ReportUncheckedCreateInput
    include?: Prisma.ReportInclude
  }): Promise<ReportWithTenant> {
    return this.prisma.report.create(params) as unknown as Promise<ReportWithTenant>
  }

  async updateManyReports(params: {
    where: Prisma.ReportWhereInput
    data: Prisma.ReportUpdateManyMutationInput | Record<string, unknown>
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.report.updateMany(params)
  }

  async deleteManyReports(params: {
    where: Prisma.ReportWhereInput
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.report.deleteMany(params)
  }

  async findUserByEmail(email: string): Promise<Pick<User, 'name'> | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { name: true },
    })
  }

  async findUsersByEmails(emails: string[]): Promise<Pick<User, 'email' | 'name'>[]> {
    return this.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, name: true },
    })
  }
}
