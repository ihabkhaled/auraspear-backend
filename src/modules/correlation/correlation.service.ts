import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CorrelationExecutor } from './correlation.executor'
import { CorrelationRepository } from './correlation.repository'
import {
  buildRuleListWhere,
  buildRuleOrderBy,
  buildRuleUpdateData,
  buildCorrelationStats,
  extractCorrelationRuleInput,
} from './correlation.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  RuleSource,
  RuleStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  CorrelationEvent,
  CorrelationResult,
  CorrelationStats,
  PaginatedRules,
  RuleRecord,
} from './correlation.types'
import type { CreateRuleDto } from './dto/create-rule.dto'
import type { UpdateRuleDto } from './dto/update-rule.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name)

  constructor(
    private readonly repository: CorrelationRepository,
    private readonly appLogger: AppLoggerService,
    private readonly executor: CorrelationExecutor
  ) {}

  /**
   * Lists correlation rules for a tenant with pagination, filtering, and search.
   */
  async listRules(
    tenantId: string,
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: string,
    source?: string,
    severity?: string,
    status?: string,
    query?: string
  ): Promise<PaginatedRules> {
    const where = buildRuleListWhere(tenantId, source, severity, status, query)
    const orderBy = buildRuleOrderBy(sortBy, sortOrder)

    const [rules, total] = await Promise.all([
      this.repository.findManyWithTenant({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.repository.count(where),
    ])

    // Collect unique createdBy emails to look up user names
    const creatorEmails = [...new Set(rules.map(r => r.createdBy))]
    const creators = await this.repository.findUsersByEmails(creatorEmails)
    const creatorMap = new Map(creators.map(c => [c.email, c.name]))

    const data: RuleRecord[] = rules.map(rule => {
      const { tenant, ...rest } = rule
      return {
        ...rest,
        createdByName: creatorMap.get(rule.createdBy) ?? null,
        tenantName: tenant.name,
      }
    })

    this.appLogger.info('Listed correlation rules', {
      feature: AppLogFeature.CORRELATION,
      action: 'listRules',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'listRules',
      targetResource: 'CorrelationRule',
      metadata: { page, limit, total },
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /**
   * Gets a single correlation rule by ID, scoped to tenant.
   */
  async getRuleById(id: string, tenantId: string): Promise<RuleRecord> {
    const rule = await this.repository.findFirstWithTenant({ id, tenantId })

    if (!rule) {
      this.appLogger.warn('Correlation rule not found', {
        feature: AppLogFeature.CORRELATION,
        action: 'getRuleById',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CorrelationService',
        functionName: 'getRuleById',
        targetResource: 'CorrelationRule',
        targetResourceId: id,
      })
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    const creator = await this.repository.findUserNameByEmail(rule.createdBy)

    this.appLogger.info('Retrieved correlation rule', {
      feature: AppLogFeature.CORRELATION,
      action: 'getRuleById',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'getRuleById',
      targetResource: 'CorrelationRule',
      targetResourceId: id,
    })

    const { tenant, ...rest } = rule
    return {
      ...rest,
      createdByName: creator?.name ?? null,
      tenantName: tenant.name,
    }
  }

  /**
   * Creates a new correlation rule with a sequential rule number.
   */
  async createRule(dto: CreateRuleDto, user: JwtPayload): Promise<RuleRecord> {
    const prefix = dto.source === RuleSource.SIGMA ? 'SIG' : 'COR'
    const ruleNumber = await this.generateRuleNumber(user.tenantId, prefix)

    const rule = await this.repository.createWithTenant({
      tenantId: user.tenantId,
      ruleNumber,
      title: dto.title,
      description: dto.description,
      source: dto.source,
      severity: dto.severity,
      status: RuleStatus.ACTIVE,
      yamlContent: dto.yamlContent,
      conditions: dto.conditions ? (dto.conditions as Prisma.InputJsonValue) : Prisma.DbNull,
      mitreTactics: dto.mitreTactics ?? [],
      mitreTechniques: dto.mitreTechniques ?? [],
      createdBy: user.email,
    })

    const creator = await this.repository.findUserNameByEmail(user.email)

    this.logger.log(
      `User ${user.email} created correlation rule ${ruleNumber} for tenant ${user.tenantId}`
    )
    this.appLogger.info('Correlation rule created', {
      feature: AppLogFeature.CORRELATION,
      action: 'createRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'createRule',
      targetResource: 'CorrelationRule',
      targetResourceId: rule.id,
      metadata: { ruleNumber, source: dto.source, severity: dto.severity },
    })

    const { tenant, ...rest } = rule
    return {
      ...rest,
      createdByName: creator?.name ?? null,
      tenantName: tenant.name,
    }
  }

  /**
   * Updates an existing correlation rule, verifying tenant ownership.
   */
  async updateRule(id: string, dto: UpdateRuleDto, user: JwtPayload): Promise<RuleRecord> {
    const existing = await this.repository.findFirstSelect(
      { id, tenantId: user.tenantId },
      { id: true }
    )

    if (!existing) {
      this.appLogger.warn('Correlation rule not found for update', {
        feature: AppLogFeature.CORRELATION,
        action: 'updateRule',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CorrelationService',
        functionName: 'updateRule',
        targetResource: 'CorrelationRule',
        targetResourceId: id,
      })
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    const rule = await this.repository.updateWithTenant({
      where: { id, tenantId: user.tenantId },
      data: buildRuleUpdateData(dto),
    })

    if (!rule) {
      throw new BusinessException(404, 'Rule not found after update', 'errors.correlation.notFound')
    }

    const creator = await this.repository.findUserNameByEmail(rule.createdBy)

    this.logger.log(`User ${user.email} updated correlation rule ${id}`)
    this.appLogger.info('Correlation rule updated', {
      feature: AppLogFeature.CORRELATION,
      action: 'updateRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'updateRule',
      targetResource: 'CorrelationRule',
      targetResourceId: id,
      metadata: { updatedFields: Object.keys(dto) },
    })

    const { tenant, ...rest } = rule
    return {
      ...rest,
      createdByName: creator?.name ?? null,
      tenantName: tenant.name,
    }
  }

  /**
   * Toggles a correlation rule between active and disabled status.
   */
  async toggleRule(id: string, enabled: boolean, user: JwtPayload): Promise<RuleRecord> {
    const existing = await this.repository.findFirstSelect(
      { id, tenantId: user.tenantId },
      { id: true }
    )

    if (!existing) {
      this.appLogger.warn('Correlation rule not found for toggle', {
        feature: AppLogFeature.CORRELATION,
        action: 'toggleRule',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CorrelationService',
        functionName: 'toggleRule',
        targetResource: 'CorrelationRule',
        targetResourceId: id,
      })
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    const newStatus = enabled ? RuleStatus.ACTIVE : RuleStatus.DISABLED
    const rule = await this.repository.updateWithTenant({
      where: { id, tenantId: user.tenantId },
      data: { status: newStatus },
    })

    if (!rule) {
      throw new BusinessException(404, 'Rule not found after toggle', 'errors.correlation.notFound')
    }

    const creator = await this.repository.findUserNameByEmail(rule.createdBy)

    this.logger.log(`User ${user.email} toggled correlation rule ${id} to ${newStatus}`)
    this.appLogger.info('Correlation rule toggled', {
      feature: AppLogFeature.CORRELATION,
      action: 'toggleRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'toggleRule',
      targetResource: 'CorrelationRule',
      targetResourceId: id,
      metadata: { enabled, newStatus },
    })

    const { tenant, ...rest } = rule
    return {
      ...rest,
      createdByName: creator?.name ?? null,
      tenantName: tenant.name,
    }
  }

  /**
   * Deletes a correlation rule, verifying tenant ownership.
   */
  async deleteRule(id: string, tenantId: string, email: string): Promise<{ deleted: boolean }> {
    const existing = await this.repository.findFirstSelect(
      { id, tenantId },
      { id: true, ruleNumber: true }
    )

    if (!existing) {
      this.appLogger.warn('Correlation rule not found for deletion', {
        feature: AppLogFeature.CORRELATION,
        action: 'deleteRule',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorEmail: email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CorrelationService',
        functionName: 'deleteRule',
        targetResource: 'CorrelationRule',
        targetResourceId: id,
      })
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    await this.repository.deleteByIdAndTenantId(id, tenantId)

    this.logger.log(
      `User ${email} deleted correlation rule ${(existing as { ruleNumber: string }).ruleNumber} (${id})`
    )
    this.appLogger.info('Correlation rule deleted', {
      feature: AppLogFeature.CORRELATION,
      action: 'deleteRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'deleteRule',
      targetResource: 'CorrelationRule',
      targetResourceId: id,
      metadata: { ruleNumber: (existing as { ruleNumber: string }).ruleNumber },
    })

    return { deleted: true }
  }

  /**
   * Returns correlation statistics for a tenant.
   */
  async getCorrelationStats(tenantId: string): Promise<CorrelationStats> {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const [correlationRules, sigmaRules, fired24hResult, linkedResult] = await Promise.all([
      this.repository.count({ tenantId, source: { not: 'sigma' } }),
      this.repository.count({ tenantId, source: 'sigma' }),
      this.repository.aggregate({
        where: {
          tenantId,
          lastFiredAt: { gte: twentyFourHoursAgo },
        },
        _sum: { hitCount: true },
      }),
      this.repository.aggregate({
        where: { tenantId },
        _sum: { linkedIncidents: true },
      }),
    ])

    this.appLogger.info('Retrieved correlation stats', {
      feature: AppLogFeature.CORRELATION,
      action: 'getCorrelationStats',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'getCorrelationStats',
      targetResource: 'CorrelationRule',
    })

    return buildCorrelationStats(correlationRules, sigmaRules, fired24hResult, linkedResult)
  }

  /* ---------------------------------------------------------------- */
  /* TEST (dry-run)                                                      */
  /* ---------------------------------------------------------------- */

  async testRule(
    id: string,
    tenantId: string,
    events: Record<string, unknown>[],
    actorEmail: string
  ): Promise<CorrelationResult> {
    const rule = await this.getRuleById(id, tenantId)

    const correlationEvents: CorrelationEvent[] = events.map(event => ({
      type:
        typeof Reflect.get(event, 'type') === 'string'
          ? (Reflect.get(event, 'type') as string)
          : 'unknown',
      timestamp:
        typeof Reflect.get(event, 'timestamp') === 'string'
          ? (Reflect.get(event, 'timestamp') as string)
          : new Date().toISOString(),
      data: event,
    }))

    const ruleInput = extractCorrelationRuleInput(rule)

    const result = await this.executor.evaluateRule(ruleInput, correlationEvents)

    this.appLogger.info('Correlation rule test executed', {
      feature: AppLogFeature.CORRELATION,
      action: 'testRule',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail,
      targetResource: 'CorrelationRule',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: 'testRule',
      metadata: {
        inputCount: events.length,
        status: result.status,
        eventsCorrelated: result.eventsCorrelated,
        durationMs: result.durationMs,
      },
    })

    return result
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE HELPERS                                                     */
  /* ---------------------------------------------------------------- */

  private async generateRuleNumber(tenantId: string, prefix: string): Promise<string> {
    const year = new Date().getFullYear()
    const searchPrefix = `${prefix}-${year}-`
    const lastRule = await this.repository.findLastRuleByPrefix(tenantId, searchPrefix)

    let nextNumber = 1
    if (lastRule?.ruleNumber) {
      const parts = lastRule.ruleNumber.split('-')
      const lastSegment = parts[parts.length - 1]
      if (lastSegment) {
        const parsed = Number.parseInt(lastSegment, 10)
        if (!Number.isNaN(parsed)) {
          nextNumber = parsed + 1
        }
      }
    }

    return `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`
  }
}
