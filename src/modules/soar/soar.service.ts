import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { SoarRepository } from './soar.repository'
import {
  buildPlaybookListWhere,
  buildPlaybookOrderBy,
  buildPlaybookUpdateData,
  buildPlaybookRecord,
  buildExecutionRecord,
  buildSoarStats,
} from './soar.utils'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  SoarPlaybookStatus,
  SoarExecutionStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreatePlaybookDto } from './dto/create-playbook.dto'
import type { UpdatePlaybookDto } from './dto/update-playbook.dto'
import type {
  SoarPlaybookRecord,
  PaginatedPlaybooks,
  SoarExecutionRecord,
  PaginatedExecutions,
  SoarStats,
} from './soar.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class SoarService {
  private readonly logger = new Logger(SoarService.name)

  constructor(
    private readonly repository: SoarRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* RESOLVE HELPERS                                                    */
  /* ---------------------------------------------------------------- */

  private async resolveCreatorName(email: string | null): Promise<string | null> {
    if (!email) return null
    const user = await this.repository.findUserByEmail(email)
    return user?.name ?? null
  }

  private async resolveCreatorNamesBatch(emails: (string | null)[]): Promise<Map<string, string>> {
    const uniqueEmails = [...new Set(emails.filter((e): e is string => e !== null))]
    if (uniqueEmails.length === 0) return new Map()
    const users = await this.repository.findUsersByEmails(uniqueEmails)
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.email, u.name)
    }
    return map
  }

  /* ---------------------------------------------------------------- */
  /* LIST PLAYBOOKS (paginated, tenant-scoped)                         */
  /* ---------------------------------------------------------------- */

  async listPlaybooks(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    status?: string,
    triggerType?: string,
    query?: string
  ): Promise<PaginatedPlaybooks> {
    const where = buildPlaybookListWhere(tenantId, status, triggerType, query)

    const [playbooks, total] = await Promise.all([
      this.repository.findManyPlaybooksWithTenant({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildPlaybookOrderBy(sortBy, sortOrder),
      }),
      this.repository.countPlaybooks(where),
    ])

    const creatorsMap = await this.resolveCreatorNamesBatch(playbooks.map(p => p.createdBy))

    const data: SoarPlaybookRecord[] = playbooks.map(p =>
      buildPlaybookRecord(p, p.createdBy ? (creatorsMap.get(p.createdBy) ?? null) : null)
    )

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET PLAYBOOK BY ID                                                */
  /* ---------------------------------------------------------------- */

  async getPlaybookById(id: string, tenantId: string): Promise<SoarPlaybookRecord> {
    const playbook = await this.repository.findFirstPlaybookWithTenant({ id, tenantId })

    if (!playbook) {
      this.appLogger.warn('Playbook not found', {
        feature: AppLogFeature.SOAR,
        action: 'getPlaybookById',
        className: 'SoarService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { playbookId: id, tenantId },
      })
      throw new BusinessException(404, `Playbook ${id} not found`, 'errors.soar.playbookNotFound')
    }

    const createdByName = await this.resolveCreatorName(playbook.createdBy)

    return buildPlaybookRecord(playbook, createdByName)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE PLAYBOOK                                                   */
  /* ---------------------------------------------------------------- */

  async createPlaybook(dto: CreatePlaybookDto, user: JwtPayload): Promise<SoarPlaybookRecord> {
    const playbook = await this.repository.createPlaybookWithTenant({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      triggerType: dto.triggerType,
      triggerConditions: dto.triggerConditions
        ? (dto.triggerConditions as Prisma.InputJsonValue)
        : Prisma.DbNull,
      steps: dto.steps as Prisma.InputJsonValue,
      status: SoarPlaybookStatus.DRAFT,
      executionCount: 0,
      createdBy: user.email,
    })

    this.appLogger.info('Playbook created', {
      feature: AppLogFeature.SOAR,
      action: 'createPlaybook',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'SoarPlaybook',
      targetResourceId: playbook.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'SoarService',
      functionName: 'createPlaybook',
      metadata: { name: playbook.name, triggerType: playbook.triggerType },
    })

    const createdByName = await this.resolveCreatorName(playbook.createdBy)

    return buildPlaybookRecord(playbook, createdByName)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PLAYBOOK                                                   */
  /* ---------------------------------------------------------------- */

  async updatePlaybook(
    id: string,
    dto: UpdatePlaybookDto,
    user: JwtPayload
  ): Promise<SoarPlaybookRecord> {
    await this.getPlaybookById(id, user.tenantId)

    const updated = await this.repository.updateManyPlaybooks({
      where: { id, tenantId: user.tenantId },
      data: buildPlaybookUpdateData(dto),
    })

    if (updated.count === 0) {
      throw new BusinessException(404, `Playbook ${id} not found`, 'errors.soar.playbookNotFound')
    }

    this.appLogger.info('Playbook updated', {
      feature: AppLogFeature.SOAR,
      action: 'updatePlaybook',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'SoarPlaybook',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'SoarService',
      functionName: 'updatePlaybook',
    })

    return this.getPlaybookById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE PLAYBOOK                                                   */
  /* ---------------------------------------------------------------- */

  async deletePlaybook(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getPlaybookById(id, tenantId)

    await this.repository.deleteManyPlaybooks({ id, tenantId })

    this.appLogger.info(`Playbook ${existing.name} deleted`, {
      feature: AppLogFeature.SOAR,
      action: 'deletePlaybook',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'SoarPlaybook',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'SoarService',
      functionName: 'deletePlaybook',
      metadata: { name: existing.name },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LIST EXECUTIONS                                                   */
  /* ---------------------------------------------------------------- */

  async listExecutions(
    tenantId: string,
    playbookId?: string,
    page = 1,
    limit = 20
  ): Promise<PaginatedExecutions> {
    const where: Prisma.SoarExecutionWhereInput = { tenantId }

    if (playbookId) {
      where.playbookId = playbookId
    }

    const [executions, total] = await Promise.all([
      this.repository.findManyExecutionsWithPlaybook({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { startedAt: 'desc' },
      }),
      this.repository.countExecutions(where),
    ])

    const creatorsMap = await this.resolveCreatorNamesBatch(executions.map(e => e.triggeredBy))

    const data: SoarExecutionRecord[] = executions.map(e =>
      buildExecutionRecord(e, e.triggeredBy ? (creatorsMap.get(e.triggeredBy) ?? null) : null)
    )

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* EXECUTE PLAYBOOK                                                  */
  /* ---------------------------------------------------------------- */

  async executePlaybook(id: string, user: JwtPayload): Promise<SoarExecutionRecord> {
    const playbook = await this.getPlaybookById(id, user.tenantId)

    if (playbook.status !== SoarPlaybookStatus.ACTIVE) {
      throw new BusinessException(
        400,
        'Only active playbooks can be executed',
        'errors.soar.playbookNotActive'
      )
    }

    const execution = await this.repository.executePlaybookTransaction({
      playbookId: id,
      tenantId: user.tenantId,
      triggeredBy: user.email,
    })

    this.appLogger.info('Playbook execution started', {
      feature: AppLogFeature.SOAR,
      action: 'executePlaybook',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'SoarExecution',
      targetResourceId: execution.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'SoarService',
      functionName: 'executePlaybook',
      metadata: { playbookId: id, playbookName: playbook.name },
    })

    const triggeredByName = await this.resolveCreatorName(execution.triggeredBy)

    return buildExecutionRecord(execution, triggeredByName)
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getSoarStats(tenantId: string): Promise<SoarStats> {
    const [
      totalPlaybooks,
      activePlaybooks,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      execTimes,
    ] = await Promise.all([
      this.repository.countPlaybooks({ tenantId }),
      this.repository.countPlaybooks({
        tenantId,
        status: SoarPlaybookStatus.ACTIVE,
      }),
      this.repository.countExecutions({ tenantId }),
      this.repository.countExecutions({
        tenantId,
        status: SoarExecutionStatus.COMPLETED,
      }),
      this.repository.countExecutions({
        tenantId,
        status: SoarExecutionStatus.FAILED,
      }),
      this.repository.findCompletedExecutions(tenantId),
    ])

    return buildSoarStats(
      totalPlaybooks,
      activePlaybooks,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      execTimes
    )
  }
}
