import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class AttackPathsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* ATTACK PATH QUERIES                                                */
  /* ---------------------------------------------------------------- */

  async findMany(params: {
    where: Prisma.AttackPathWhereInput
    orderBy: Prisma.AttackPathOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.attackPath.findMany(params)
  }

  async findManyWithTenant(params: {
    where: Prisma.AttackPathWhereInput
    orderBy: Prisma.AttackPathOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.attackPath.findMany({
      ...params,
      include: { tenant: { select: { name: true } } },
    })
  }

  async count(where: Prisma.AttackPathWhereInput) {
    return this.prisma.attackPath.count({ where })
  }

  async findFirst(where: Prisma.AttackPathWhereInput) {
    return this.prisma.attackPath.findFirst({ where })
  }

  async findFirstWithTenant(where: Prisma.AttackPathWhereInput) {
    return this.prisma.attackPath.findFirst({
      where,
      include: { tenant: { select: { name: true } } },
    })
  }

  async updateMany(params: { where: Prisma.AttackPathWhereInput; data: Record<string, unknown> }) {
    return this.prisma.attackPath.updateMany(params)
  }

  async deleteMany(where: Prisma.AttackPathWhereInput) {
    return this.prisma.attackPath.deleteMany({ where })
  }

  /* ---------------------------------------------------------------- */
  /* AGGREGATION QUERIES                                                */
  /* ---------------------------------------------------------------- */

  async aggregateSum(
    where: Prisma.AttackPathWhereInput,
    sumFields: Prisma.AttackPathAggregateArgs['_sum']
  ) {
    return this.prisma.attackPath.aggregate({
      where,
      _sum: sumFields,
    })
  }

  async aggregateAvg(
    where: Prisma.AttackPathWhereInput,
    avgFields: Prisma.AttackPathAggregateArgs['_avg']
  ) {
    return this.prisma.attackPath.aggregate({
      where,
      _avg: avgFields,
    })
  }

  /* ---------------------------------------------------------------- */
  /* TRANSACTION: CREATE WITH NUMBER GENERATION                         */
  /* ---------------------------------------------------------------- */

  async createWithNumber(params: {
    tenantId: string
    data: Omit<Prisma.AttackPathUncheckedCreateInput, 'pathNumber' | 'tenantId'>
  }) {
    return this.prisma.$transaction(async tx => {
      const pathNumber = await this.generatePathNumber(tx, params.tenantId)

      return tx.attackPath.create({
        data: {
          ...params.data,
          tenantId: params.tenantId,
          pathNumber,
        },
        include: { tenant: { select: { name: true } } },
      })
    })
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: NUMBER GENERATION                                         */
  /* ---------------------------------------------------------------- */

  private async generatePathNumber(
    tx: Prisma.TransactionClient,
    tenantId: string
  ): Promise<string> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('attack_path_number_gen'))::text`

    const prefix = 'AP-'

    const lastPath = await tx.attackPath.findFirst({
      where: {
        tenantId,
        pathNumber: { startsWith: prefix },
      },
      orderBy: { pathNumber: 'desc' },
      select: { pathNumber: true },
    })

    let nextNumber = 1

    if (lastPath?.pathNumber) {
      const parts = lastPath.pathNumber.split('-')
      const numberPart = parts[1]
      if (numberPart) {
        const parsed = Number.parseInt(numberPart, 10)
        if (!Number.isNaN(parsed)) {
          nextNumber = parsed + 1
        }
      }
    }

    return `${prefix}${String(nextNumber).padStart(4, '0')}`
  }
}
