import { Injectable, Logger } from '@nestjs/common'
import { KnowledgeRepository } from './knowledge.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreateRunbookDto } from './dto/create-runbook.dto'
import type { UpdateRunbookDto } from './dto/update-runbook.dto'
import type { RunbookResponse, RunbookSearchParameters } from './knowledge.types'
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)

  constructor(
    private readonly knowledgeRepository: KnowledgeRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async list(
    tenantId: string,
    params: RunbookSearchParameters
  ): Promise<PaginatedResponse<RunbookResponse>> {
    const [data, total] = await Promise.all([
      this.knowledgeRepository.findAllByTenant(tenantId, params),
      this.knowledgeRepository.countByTenant(tenantId, params.category),
    ])
    return { data, pagination: buildPaginationMeta(params.page, params.limit, total) }
  }

  async getById(tenantId: string, id: string): Promise<RunbookResponse> {
    const runbook = await this.knowledgeRepository.findById(id, tenantId)
    if (!runbook) {
      this.logWarn('getById', tenantId, id)
      throw new BusinessException(404, `Runbook ${id} not found`, 'errors.knowledge.notFound')
    }
    return runbook
  }

  async create(tenantId: string, dto: CreateRunbookDto, email: string): Promise<RunbookResponse> {
    const runbook = await this.knowledgeRepository.create({
      tenantId,
      title: dto.title,
      content: dto.content,
      category: dto.category ?? 'general',
      tags: dto.tags ?? [],
      createdBy: email,
    })

    this.logAction('create', tenantId, email, runbook.id, { title: dto.title })
    return runbook
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRunbookDto,
    email: string
  ): Promise<RunbookResponse> {
    const existing = await this.knowledgeRepository.findById(id, tenantId)
    if (!existing) {
      this.logWarn('update', tenantId, id)
      throw new BusinessException(404, `Runbook ${id} not found`, 'errors.knowledge.notFound')
    }

    const updated = await this.knowledgeRepository.update(id, tenantId, {
      title: dto.title,
      content: dto.content,
      category: dto.category,
      tags: dto.tags,
      updatedBy: email,
    })

    this.logAction('update', tenantId, email, id, { title: dto.title ?? existing.title })
    return updated
  }

  async delete(tenantId: string, id: string, email: string): Promise<{ deleted: boolean }> {
    const existing = await this.knowledgeRepository.findById(id, tenantId)
    if (!existing) {
      this.logWarn('delete', tenantId, id)
      throw new BusinessException(404, `Runbook ${id} not found`, 'errors.knowledge.notFound')
    }

    await this.knowledgeRepository.delete(id, tenantId)
    this.logAction('delete', tenantId, email, id, { title: existing.title })
    return { deleted: true }
  }

  async search(tenantId: string, query: string): Promise<RunbookResponse[]> {
    return this.knowledgeRepository.search(tenantId, query, 50)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logAction(
    action: string,
    tenantId: string,
    email: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`Knowledge action: ${action}`, {
      feature: AppLogFeature.KNOWLEDGE,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      sourceType: AppLogSourceType.SERVICE,
      className: 'KnowledgeService',
      functionName: action,
      targetResource: 'Runbook',
      targetResourceId: resourceId,
      metadata,
    })
  }

  private logWarn(action: string, tenantId: string, resourceId?: string): void {
    this.appLogger.warn(`Knowledge action failed: ${action}`, {
      feature: AppLogFeature.KNOWLEDGE,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'KnowledgeService',
      functionName: action,
      targetResource: 'Runbook',
      targetResourceId: resourceId,
    })
  }
}
