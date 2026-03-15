import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  Prisma,
  DetectionRuleStatus as PrismaDetectionRuleStatus,
  DetectionRuleType as PrismaDetectionRuleType,
  DetectionRuleSeverity as PrismaDetectionRuleSeverity,
} from '@prisma/client'

@Injectable()
export class DetectionRulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* FIND                                                              */
  /* ---------------------------------------------------------------- */

  async findMany(params: {
    where: Prisma.DetectionRuleWhereInput
    skip: number
    take: number
    orderBy: Prisma.DetectionRuleOrderByWithRelationInput
  }) {
    return this.prisma.detectionRule.findMany(params)
  }

  async findFirst(params: { where: Prisma.DetectionRuleWhereInput }) {
    return this.prisma.detectionRule.findFirst(params)
  }

  /* ---------------------------------------------------------------- */
  /* COUNT / AGGREGATE                                                 */
  /* ---------------------------------------------------------------- */

  async count(where: Prisma.DetectionRuleWhereInput): Promise<number> {
    return this.prisma.detectionRule.count({ where })
  }

  async countByStatus(tenantId: string, status: PrismaDetectionRuleStatus): Promise<number> {
    return this.prisma.detectionRule.count({
      where: { tenantId, status },
    })
  }

  async aggregateHitCount(tenantId: string) {
    return this.prisma.detectionRule.aggregate({
      where: { tenantId },
      _sum: { hitCount: true },
    })
  }

  /* ---------------------------------------------------------------- */
  /* CREATE (with advisory-lock rule number generation)                */
  /* ---------------------------------------------------------------- */

  async createInTransaction(data: {
    tenantId: string
    name: string
    description: string | null
    ruleType: PrismaDetectionRuleType
    severity: PrismaDetectionRuleSeverity
    status: PrismaDetectionRuleStatus
    conditions: Prisma.InputJsonValue
    actions: Prisma.InputJsonValue
    createdBy: string
  }) {
    return this.prisma.$transaction(async tx => {
      const ruleNumber = await this.generateRuleNumber(tx, data.tenantId)

      return tx.detectionRule.create({
        data: {
          tenantId: data.tenantId,
          ruleNumber,
          name: data.name,
          description: data.description,
          ruleType: data.ruleType,
          severity: data.severity,
          status: data.status,
          conditions: data.conditions,
          actions: data.actions,
          createdBy: data.createdBy,
        },
      })
    })
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateMany(params: {
    where: Prisma.DetectionRuleWhereInput
    data: Prisma.DetectionRuleUncheckedUpdateManyInput
  }) {
    return this.prisma.detectionRule.updateMany(params)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteMany(where: Prisma.DetectionRuleWhereInput) {
    return this.prisma.detectionRule.deleteMany({ where })
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE — rule number generation                                  */
  /* ---------------------------------------------------------------- */

  private async generateRuleNumber(
    tx: Prisma.TransactionClient,
    tenantId: string
  ): Promise<string> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('detection_rule_number_gen'))::text`

    const prefix = 'DR-'

    const latestRule = await tx.detectionRule.findFirst({
      where: {
        tenantId,
        ruleNumber: { startsWith: prefix },
      },
      orderBy: { ruleNumber: 'desc' },
      select: { ruleNumber: true },
    })

    let nextSequence = 1

    if (latestRule) {
      const parts = latestRule.ruleNumber.split('-')
      const lastSegment = parts[parts.length - 1]
      if (lastSegment) {
        const parsed = Number.parseInt(lastSegment, 10)
        if (!Number.isNaN(parsed)) {
          nextSequence = parsed + 1
        }
      }
    }

    const year = new Date().getFullYear()
    return `DR-${year}-${String(nextSequence).padStart(4, '0')}`
  }
}
