import { Injectable, Logger } from '@nestjs/common'
import { DetectionRulesRepository } from './detection-rules.repository'
import {
  buildDetectionRuleRecord,
  buildRuleListWhere,
  buildRuleOrderBy,
  buildRuleUpdateData,
  buildDetectionRuleStats,
} from './detection-rules.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  DetectionRuleStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  DetectionRuleRecord,
  DetectionRuleStats,
  PaginatedDetectionRules,
} from './detection-rules.types'
import type { CreateDetectionRuleDto } from './dto/create-detection-rule.dto'
import type { UpdateDetectionRuleDto } from './dto/update-detection-rule.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Prisma } from '@prisma/client'

@Injectable()
export class DetectionRulesService {
  private readonly logger = new Logger(DetectionRulesService.name)

  constructor(
    private readonly repository: DetectionRulesRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listRules(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    ruleType?: string,
    severity?: string,
    status?: string,
    query?: string
  ): Promise<PaginatedDetectionRules> {
    const where = buildRuleListWhere(tenantId, ruleType, severity, status, query)
    const orderBy = buildRuleOrderBy(sortBy, sortOrder)

    const [rules, total] = await Promise.all([
      this.repository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.count(where),
    ])

    const data: DetectionRuleRecord[] = rules.map(buildDetectionRuleRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getRuleById(id: string, tenantId: string): Promise<DetectionRuleRecord> {
    const rule = await this.repository.findFirst({
      where: { id, tenantId },
    })

    if (!rule) {
      this.appLogger.warn('Detection rule not found', {
        feature: AppLogFeature.DETECTION_RULES,
        action: 'getRuleById',
        className: 'DetectionRulesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { ruleId: id, tenantId },
      })
      throw new BusinessException(
        404,
        `Detection rule ${id} not found`,
        'errors.detectionRules.notFound'
      )
    }

    return buildDetectionRuleRecord(rule)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createRule(dto: CreateDetectionRuleDto, user: JwtPayload): Promise<DetectionRuleRecord> {
    const result = await this.repository.createInTransaction({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      ruleType: dto.ruleType,
      severity: dto.severity,
      status: DetectionRuleStatus.TESTING,
      conditions: dto.conditions as Prisma.InputJsonValue,
      actions: dto.actions as Prisma.InputJsonValue,
      createdBy: user.email,
    })

    this.appLogger.info('Detection rule created', {
      feature: AppLogFeature.DETECTION_RULES,
      action: 'createRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'DetectionRule',
      targetResourceId: result.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DetectionRulesService',
      functionName: 'createRule',
      metadata: { ruleNumber: result.ruleNumber, severity: result.severity },
    })

    return buildDetectionRuleRecord(result)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateRule(
    id: string,
    dto: UpdateDetectionRuleDto,
    user: JwtPayload
  ): Promise<DetectionRuleRecord> {
    await this.getRuleById(id, user.tenantId)

    const updateData = buildRuleUpdateData(dto)

    const updated = await this.repository.updateMany({
      where: { id, tenantId: user.tenantId },
      data: updateData,
    })

    if (updated.count === 0) {
      throw new BusinessException(
        404,
        `Detection rule ${id} not found`,
        'errors.detectionRules.notFound'
      )
    }

    this.appLogger.info('Detection rule updated', {
      feature: AppLogFeature.DETECTION_RULES,
      action: 'updateRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'DetectionRule',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DetectionRulesService',
      functionName: 'updateRule',
    })

    return this.getRuleById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteRule(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getRuleById(id, tenantId)

    await this.repository.deleteMany({ id, tenantId })

    this.appLogger.info(`Detection rule ${existing.ruleNumber} deleted`, {
      feature: AppLogFeature.DETECTION_RULES,
      action: 'deleteRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'DetectionRule',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DetectionRulesService',
      functionName: 'deleteRule',
      metadata: { ruleNumber: existing.ruleNumber },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getDetectionRuleStats(tenantId: string): Promise<DetectionRuleStats> {
    const [total, active, testing, disabled, aggregates] = await Promise.all([
      this.repository.count({ tenantId }),
      this.repository.countByStatus(tenantId, DetectionRuleStatus.ACTIVE),
      this.repository.countByStatus(tenantId, DetectionRuleStatus.TESTING),
      this.repository.countByStatus(tenantId, DetectionRuleStatus.DISABLED),
      this.repository.aggregateHitCount(tenantId),
    ])

    return buildDetectionRuleStats(total, active, testing, disabled, aggregates)
  }
}
