import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  Prisma,
  CloudAccountStatus as PrismaCloudAccountStatus,
  CloudFindingStatus as PrismaCloudFindingStatus,
  CloudFindingSeverity as PrismaCloudFindingSeverity,
} from '@prisma/client'

@Injectable()
export class CloudSecurityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* ACCOUNT QUERIES                                                    */
  /* ---------------------------------------------------------------- */

  async findManyAccounts(params: {
    where: Record<string, unknown>
    skip: number
    take: number
    orderBy: Record<string, string>
  }) {
    return this.prisma.cloudAccount.findMany(params)
  }

  async countAccounts(where: Record<string, unknown>): Promise<number> {
    return this.prisma.cloudAccount.count({ where })
  }

  async findFirstAccount(where: { id: string; tenantId: string }) {
    return this.prisma.cloudAccount.findFirst({ where })
  }

  async createAccount(data: Prisma.CloudAccountUncheckedCreateInput) {
    return this.prisma.cloudAccount.create({ data })
  }

  async updateManyAccounts(params: {
    where: { id: string; tenantId: string }
    data: Record<string, unknown>
  }) {
    return this.prisma.cloudAccount.updateMany(params)
  }

  async deleteManyAccounts(where: { id: string; tenantId: string }) {
    return this.prisma.cloudAccount.deleteMany({ where })
  }

  async countAccountsByStatus(tenantId: string, status: PrismaCloudAccountStatus): Promise<number> {
    return this.prisma.cloudAccount.count({
      where: { tenantId, status },
    })
  }

  /* ---------------------------------------------------------------- */
  /* FINDING QUERIES                                                    */
  /* ---------------------------------------------------------------- */

  async findManyFindings(params: {
    where: Record<string, unknown>
    skip: number
    take: number
    orderBy: Record<string, string>
  }) {
    return this.prisma.cloudFinding.findMany(params)
  }

  async countFindings(where: Record<string, unknown>): Promise<number> {
    return this.prisma.cloudFinding.count({ where })
  }

  async countFindingsByStatus(tenantId: string, status: PrismaCloudFindingStatus): Promise<number> {
    return this.prisma.cloudFinding.count({
      where: { tenantId, status },
    })
  }

  async countFindingsBySeverity(
    tenantId: string,
    severity: PrismaCloudFindingSeverity
  ): Promise<number> {
    return this.prisma.cloudFinding.count({
      where: { tenantId, severity },
    })
  }
}
