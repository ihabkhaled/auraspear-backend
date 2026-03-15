import { Injectable, Logger } from '@nestjs/common'
import { CorrelationRepository } from './correlation.repository'
import {
  buildRuleListWhere,
  buildRuleOrderBy,
  buildRuleUpdateData,
  buildCorrelationStats,
} from './correlation.utils'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, RuleSource } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CorrelationStats, PaginatedRules, RuleRecord } from './correlation.types'
import type { CreateRuleDto } from './dto/create-rule.dto'
import type { UpdateRuleDto } from './dto/update-rule.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name)

  constructor(
    private readonly repository: CorrelationRepository,
    private readonly appLogger: AppLoggerService
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

    // Collect unique createdBy values to look up user names
    const creatorIds = [...new Set(rules.map(r => r.createdBy))]
    const creators = await this.repository.findUsersByIds(creatorIds)
    const creatorMap = new Map(creators.map(c => [c.id, c.name]))

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

    const creator = await this.repository.findUserNameById(rule.createdBy)

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
      status: 'active',
      yamlContent: dto.yamlContent,
      mitreTactics: dto.mitreTactics ?? [],
      mitreTechniques: dto.mitreTechniques ?? [],
      createdBy: user.sub,
    })

    const creator = await this.repository.findUserNameById(user.sub)

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

    const creator = await this.repository.findUserNameById(rule.createdBy)

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
  /* PRIVATE HELPERS                                                     */
  /* ---------------------------------------------------------------- */

  private async generateRuleNumber(tenantId: string, prefix: string): Promise<string> {
    const lastRule = await this.repository.findLastRuleByPrefix(tenantId, prefix)

    let nextNumber = 1
    if (lastRule?.ruleNumber) {
      const parts = lastRule.ruleNumber.split('-')
      const numberPart = parts[1]
      if (numberPart) {
        const parsed = Number.parseInt(numberPart, 10)
        if (!Number.isNaN(parsed)) {
          nextNumber = parsed + 1
        }
      }
    }

    return `${prefix}-${String(nextNumber).padStart(4, '0')}`
  }
}
