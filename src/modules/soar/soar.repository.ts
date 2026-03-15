import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { SoarExecutionStatus } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class SoarRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* PLAYBOOKS                                                         */
  /* ---------------------------------------------------------------- */

  private static readonly PLAYBOOK_WITH_TENANT = {
    tenant: { select: { name: true } },
  } as const satisfies Prisma.SoarPlaybookInclude

  async findManyPlaybooksWithTenant(params: {
    where: Prisma.SoarPlaybookWhereInput
    skip: number
    take: number
    orderBy: Prisma.SoarPlaybookOrderByWithRelationInput
  }) {
    return this.prisma.soarPlaybook.findMany({
      ...params,
      include: SoarRepository.PLAYBOOK_WITH_TENANT,
    })
  }

  async countPlaybooks(where: Prisma.SoarPlaybookWhereInput): Promise<number> {
    return this.prisma.soarPlaybook.count({ where })
  }

  async findFirstPlaybookWithTenant(where: Prisma.SoarPlaybookWhereInput) {
    return this.prisma.soarPlaybook.findFirst({
      where,
      include: SoarRepository.PLAYBOOK_WITH_TENANT,
    })
  }

  async createPlaybookWithTenant(data: Prisma.SoarPlaybookUncheckedCreateInput) {
    return this.prisma.soarPlaybook.create({
      data,
      include: SoarRepository.PLAYBOOK_WITH_TENANT,
    })
  }

  async updateManyPlaybooks(params: {
    where: Prisma.SoarPlaybookWhereInput
    data: Prisma.SoarPlaybookUpdateManyMutationInput
  }) {
    return this.prisma.soarPlaybook.updateMany(params)
  }

  async deleteManyPlaybooks(where: Prisma.SoarPlaybookWhereInput) {
    return this.prisma.soarPlaybook.deleteMany({ where })
  }

  /* ---------------------------------------------------------------- */
  /* EXECUTIONS                                                        */
  /* ---------------------------------------------------------------- */

  private static readonly EXECUTION_WITH_PLAYBOOK = {
    playbook: { select: { name: true } },
  } as const satisfies Prisma.SoarExecutionInclude

  async findManyExecutionsWithPlaybook(params: {
    where: Prisma.SoarExecutionWhereInput
    skip: number
    take: number
    orderBy: Prisma.SoarExecutionOrderByWithRelationInput
  }) {
    return this.prisma.soarExecution.findMany({
      ...params,
      include: SoarRepository.EXECUTION_WITH_PLAYBOOK,
    })
  }

  async countExecutions(where: Prisma.SoarExecutionWhereInput): Promise<number> {
    return this.prisma.soarExecution.count({ where })
  }

  async findCompletedExecutions(tenantId: string) {
    return this.prisma.soarExecution.findMany({
      where: {
        tenantId,
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true },
    })
  }

  async executePlaybookTransaction(params: {
    playbookId: string
    tenantId: string
    triggeredBy: string
  }) {
    return this.prisma.$transaction(async tx => {
      const execution = await tx.soarExecution.create({
        data: {
          playbookId: params.playbookId,
          tenantId: params.tenantId,
          status: SoarExecutionStatus.RUNNING,
          triggeredBy: params.triggeredBy,
          startedAt: new Date(),
        },
        include: SoarRepository.EXECUTION_WITH_PLAYBOOK,
      })

      await tx.soarPlaybook.updateMany({
        where: { id: params.playbookId, tenantId: params.tenantId },
        data: {
          executionCount: { increment: 1 },
          lastExecutedAt: new Date(),
        },
      })

      return execution
    })
  }

  /* ---------------------------------------------------------------- */
  /* USERS (for creator name resolution)                               */
  /* ---------------------------------------------------------------- */

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { name: true },
    })
  }

  async findUsersByEmails(emails: string[]) {
    return this.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, name: true },
    })
  }
}
