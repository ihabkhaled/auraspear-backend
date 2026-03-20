import { Injectable, Logger } from '@nestjs/common'
import { NormalizationExecutor } from './normalization.executor'
import { NormalizationRepository } from './normalization.repository'
import {
  buildPipelineListWhere,
  buildPipelineOrderBy,
  buildPipelineUpdateData,
  buildPipelineRecord,
  buildNormalizationStats,
  extractPipelineSteps,
} from './normalization.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  NormalizationPipelineStatus,
  SortOrder,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreatePipelineDto } from './dto/create-pipeline.dto'
import type { UpdatePipelineDto } from './dto/update-pipeline.dto'
import type {
  NormalizationOutput,
  NormalizationPipelineRecord,
  NormalizationStats,
  PaginatedPipelines,
} from './normalization.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Prisma } from '@prisma/client'

@Injectable()
export class NormalizationService {
  private readonly logger = new Logger(NormalizationService.name)

  constructor(
    private readonly repository: NormalizationRepository,
    private readonly appLogger: AppLoggerService,
    private readonly executor: NormalizationExecutor
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listPipelines(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    sourceType?: string,
    status?: string,
    query?: string
  ): Promise<PaginatedPipelines> {
    const where = buildPipelineListWhere(tenantId, sourceType, status, query)
    const orderBy = buildPipelineOrderBy(sortBy, sortOrder)

    const [pipelines, total] = await Promise.all([
      this.repository.findManyPipelines({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.countPipelines(where),
    ])

    const data: NormalizationPipelineRecord[] = pipelines.map(buildPipelineRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getPipelineById(id: string, tenantId: string): Promise<NormalizationPipelineRecord> {
    const pipeline = await this.repository.findFirstPipelineByIdAndTenant(id, tenantId)

    if (!pipeline) {
      this.appLogger.warn('Normalization pipeline not found', {
        feature: AppLogFeature.NORMALIZATION,
        action: 'getPipelineById',
        className: 'NormalizationService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { pipelineId: id, tenantId },
      })
      throw new BusinessException(
        404,
        `Normalization pipeline ${id} not found`,
        'errors.normalization.notFound'
      )
    }

    return buildPipelineRecord(pipeline)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createPipeline(
    dto: CreatePipelineDto,
    user: JwtPayload
  ): Promise<NormalizationPipelineRecord> {
    const duplicates = await this.repository.findManyPipelines({
      where: { tenantId: user.tenantId, name: dto.name },
      skip: 0,
      take: 1,
      orderBy: { createdAt: SortOrder.DESC },
    })

    if (duplicates.length > 0) {
      throw new BusinessException(
        409,
        `Pipeline with name "${dto.name}" already exists`,
        'errors.normalization.pipelineAlreadyExists'
      )
    }

    const pipeline = await this.repository.createPipeline({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      sourceType: dto.sourceType,
      status: NormalizationPipelineStatus.INACTIVE,
      parserConfig: dto.parserConfig as Prisma.InputJsonValue,
      fieldMappings: dto.fieldMappings as Prisma.InputJsonValue,
    })

    this.appLogger.info('Normalization pipeline created', {
      feature: AppLogFeature.NORMALIZATION,
      action: 'createPipeline',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'NormalizationPipeline',
      targetResourceId: pipeline.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NormalizationService',
      functionName: 'createPipeline',
      metadata: { name: pipeline.name, sourceType: pipeline.sourceType },
    })

    return buildPipelineRecord(pipeline)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updatePipeline(
    id: string,
    dto: UpdatePipelineDto,
    user: JwtPayload
  ): Promise<NormalizationPipelineRecord> {
    await this.getPipelineById(id, user.tenantId)

    const updated = await this.repository.updateManyPipelinesByIdAndTenant(
      id,
      user.tenantId,
      buildPipelineUpdateData(dto)
    )

    if (updated.count === 0) {
      throw new BusinessException(
        404,
        `Normalization pipeline ${id} not found`,
        'errors.normalization.notFound'
      )
    }

    this.appLogger.info('Normalization pipeline updated', {
      feature: AppLogFeature.NORMALIZATION,
      action: 'updatePipeline',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'NormalizationPipeline',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NormalizationService',
      functionName: 'updatePipeline',
    })

    return this.getPipelineById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deletePipeline(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getPipelineById(id, tenantId)

    await this.repository.deleteManyPipelinesByIdAndTenant(id, tenantId)

    this.appLogger.info(`Normalization pipeline ${existing.name} deleted`, {
      feature: AppLogFeature.NORMALIZATION,
      action: 'deletePipeline',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'NormalizationPipeline',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NormalizationService',
      functionName: 'deletePipeline',
      metadata: { name: existing.name },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getNormalizationStats(tenantId: string): Promise<NormalizationStats> {
    const [total, active, inactive, errorPipelines, aggregates] = await Promise.all([
      this.repository.countPipelines({ tenantId }),
      this.repository.countPipelinesByStatus(tenantId, NormalizationPipelineStatus.ACTIVE),
      this.repository.countPipelinesByStatus(tenantId, NormalizationPipelineStatus.INACTIVE),
      this.repository.countPipelinesByStatus(tenantId, NormalizationPipelineStatus.ERROR),
      this.repository.aggregatePipelinesSums(tenantId),
    ])

    return buildNormalizationStats(total, active, inactive, errorPipelines, aggregates)
  }

  /* ---------------------------------------------------------------- */
  /* DRY RUN                                                           */
  /* ---------------------------------------------------------------- */

  async dryRunPipeline(
    id: string,
    tenantId: string,
    events: Record<string, unknown>[],
    actorEmail: string
  ): Promise<NormalizationOutput> {
    const pipeline = await this.getPipelineById(id, tenantId)

    const steps = extractPipelineSteps(pipeline.parserConfig, pipeline.fieldMappings)

    const output = await this.executor.executePipeline(
      { id: pipeline.id, name: pipeline.name, steps },
      events
    )

    this.appLogger.info('Normalization pipeline dry-run executed', {
      feature: AppLogFeature.NORMALIZATION,
      action: 'dryRunPipeline',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail,
      targetResource: 'NormalizationPipeline',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'NormalizationService',
      functionName: 'dryRunPipeline',
      metadata: {
        inputCount: events.length,
        outputCount: output.result.outputCount,
        droppedCount: output.result.droppedCount,
        durationMs: output.result.durationMs,
      },
    })

    return output
  }
}
