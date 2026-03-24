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
  buildRuleRecord,
  buildRuleRecordList,
  buildCorrelationEvents,
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

    const [rules, total] = await Promise.all([
      this.repository.findManyWithTenant({
        where,
        orderBy: buildRuleOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.repository.count(where),
    ])

    const creatorEmails = [...new Set(rules.map(r => r.createdBy))]
    const creators = await this.repository.findUsersByEmails(creatorEmails)
    const creatorMap = new Map(creators.map(c => [c.email, c.name]))
    const data = buildRuleRecordList(rules, creatorMap)

    this.logAction('listRules', tenantId, { page, limit, total })

    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  /**
   * Gets a single correlation rule by ID, scoped to tenant.
   */
  async getRuleById(id: string, tenantId: string): Promise<RuleRecord> {
    const rule = await this.repository.findFirstWithTenant({ id, tenantId })

    if (!rule) {
      this.logWarn('getRuleById', tenantId, id)
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    const creator = await this.repository.findUserNameByEmail(rule.createdBy)
    this.logAction('getRuleById', tenantId, { ruleId: id })

    return buildRuleRecord(rule, creator?.name ?? null)
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
    this.logger.log(`User ${user.email} created correlation rule ${ruleNumber} for tenant ${user.tenantId}`)
    this.logAction('createRule', user.tenantId, { ruleNumber, source: dto.source, severity: dto.severity })

    return buildRuleRecord(rule, creator?.name ?? null)
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
      this.logWarn('updateRule', user.tenantId, id)
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
    this.logAction('updateRule', user.tenantId, { ruleId: id, updatedFields: Object.keys(dto) })

    return buildRuleRecord(rule, creator?.name ?? null)
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
      this.logWarn('toggleRule', user.tenantId, id)
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
    this.logAction('toggleRule', user.tenantId, { ruleId: id, enabled, newStatus })

    return buildRuleRecord(rule, creator?.name ?? null)
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
      this.logWarn('deleteRule', tenantId, id)
      throw new BusinessException(404, 'Rule not found', 'errors.correlation.notFound')
    }

    await this.repository.deleteByIdAndTenantId(id, tenantId)

    const {ruleNumber} = (existing as { ruleNumber: string })
    this.logger.log(`User ${email} deleted correlation rule ${ruleNumber} (${id})`)
    this.logAction('deleteRule', tenantId, { ruleId: id, ruleNumber })

    return { deleted: true }
  }

  /**
   * Returns correlation statistics for a tenant.
   */
  async getCorrelationStats(tenantId: string): Promise<CorrelationStats> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [correlationRules, sigmaRules, fired24hResult, linkedResult] = await Promise.all([
      this.repository.count({ tenantId, source: { not: 'sigma' } }),
      this.repository.count({ tenantId, source: 'sigma' }),
      this.repository.aggregate({
        where: { tenantId, lastFiredAt: { gte: twentyFourHoursAgo } },
        _sum: { hitCount: true },
      }),
      this.repository.aggregate({
        where: { tenantId },
        _sum: { linkedIncidents: true },
      }),
    ])

    this.logAction('getCorrelationStats', tenantId, {})
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
    const correlationEvents = buildCorrelationEvents(events)
    const ruleInput = extractCorrelationRuleInput(rule)
    const result = await this.executor.evaluateRule(ruleInput, correlationEvents)

    this.logAction('testRule', tenantId, {
      ruleId: id,
      actorEmail,
      inputCount: events.length,
      status: result.status,
      eventsCorrelated: result.eventsCorrelated,
      durationMs: result.durationMs,
    })

    return result
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE HELPERS                                                     */
  /* ---------------------------------------------------------------- */

  private logAction(action: string, tenantId: string, metadata: Record<string, unknown>): void {
    this.appLogger.info(`Correlation: ${action}`, {
      feature: AppLogFeature.CORRELATION,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: action,
      targetResource: 'CorrelationRule',
      metadata,
    })
  }

  private logWarn(action: string, tenantId: string, ruleId: string): void {
    this.appLogger.warn(`Correlation rule not found for ${action}`, {
      feature: AppLogFeature.CORRELATION,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CorrelationService',
      functionName: action,
      targetResource: 'CorrelationRule',
      targetResourceId: ruleId,
    })
  }

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
