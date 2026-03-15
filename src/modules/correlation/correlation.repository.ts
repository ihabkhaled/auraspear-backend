import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class CorrelationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* CORRELATION RULE QUERIES                                           */
  /* ---------------------------------------------------------------- */

  async findMany(params: {
    where: Prisma.CorrelationRuleWhereInput
    orderBy: Prisma.CorrelationRuleOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.correlationRule.findMany(params)
  }

  async findManyWithTenant(params: {
    where: Prisma.CorrelationRuleWhereInput
    orderBy: Prisma.CorrelationRuleOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.correlationRule.findMany({
      ...params,
      include: { tenant: { select: { name: true } } },
    })
  }

  async count(where: Prisma.CorrelationRuleWhereInput) {
    return this.prisma.correlationRule.count({ where })
  }

  async findFirstWithTenant(where: Prisma.CorrelationRuleWhereInput) {
    return this.prisma.correlationRule.findFirst({
      where,
      include: { tenant: { select: { name: true } } },
    })
  }

  async findFirstSelect(
    where: Prisma.CorrelationRuleWhereInput,
    select: Prisma.CorrelationRuleSelect
  ) {
    return this.prisma.correlationRule.findFirst({ where, select })
  }

  async create(data: Prisma.CorrelationRuleUncheckedCreateInput) {
    return this.prisma.correlationRule.create({ data })
  }

  async createWithTenant(data: Prisma.CorrelationRuleUncheckedCreateInput) {
    return this.prisma.correlationRule.create({
      data,
      include: { tenant: { select: { name: true } } },
    })
  }

  async update(params: {
    where: { id: string; tenantId: string }
    data: Prisma.CorrelationRuleUpdateInput
  }) {
    return this.prisma.correlationRule.update({
      where: { id: params.where.id, tenantId: params.where.tenantId },
      data: params.data,
    })
  }

  async updateWithTenant(params: {
    where: { id: string; tenantId: string }
    data: Prisma.CorrelationRuleUpdateInput
  }) {
    return this.prisma.correlationRule.update({
      where: { id: params.where.id, tenantId: params.where.tenantId },
      data: params.data,
      include: { tenant: { select: { name: true } } },
    })
  }

  async deleteByIdAndTenantId(id: string, tenantId: string) {
    return this.prisma.correlationRule.delete({
      where: { id, tenantId },
    })
  }

  /* ---------------------------------------------------------------- */
  /* AGGREGATION QUERIES                                                */
  /* ---------------------------------------------------------------- */

  async aggregate(params: {
    where: Prisma.CorrelationRuleWhereInput
    _sum?: Prisma.CorrelationRuleAggregateArgs['_sum']
  }) {
    return this.prisma.correlationRule.aggregate({
      where: params.where,
      _sum: params._sum,
    })
  }

  /* ---------------------------------------------------------------- */
  /* USER LOOKUPS                                                       */
  /* ---------------------------------------------------------------- */

  async findUsersByIds(ids: string[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
  }

  async findUserNameById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })
  }

  /* ---------------------------------------------------------------- */
  /* NUMBER GENERATION                                                  */
  /* ---------------------------------------------------------------- */

  async findLastRuleByPrefix(tenantId: string, prefix: string) {
    return this.prisma.correlationRule.findFirst({
      where: {
        tenantId,
        ruleNumber: { startsWith: prefix },
      },
      orderBy: { ruleNumber: 'desc' },
      select: { ruleNumber: true },
    })
  }
}
