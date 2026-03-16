import { Injectable, Logger } from '@nestjs/common'
import { UebaRepository } from './ueba.repository'
import {
  buildEntityListWhere,
  buildEntityOrderBy,
  buildAnomalyListWhere,
  buildAnomalyOrderBy,
  buildModelListWhere,
  buildModelOrderBy,
} from './ueba.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  MlModelStatus,
  UebaRiskLevel,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreateEntityDto } from './dto/create-entity.dto'
import type { UpdateEntityDto } from './dto/update-entity.dto'
import type {
  UebaEntityRecord,
  PaginatedEntities,
  UebaAnomalyRecord,
  PaginatedAnomalies,
  PaginatedModels,
  UebaStats,
} from './ueba.types'

@Injectable()
export class UebaService {
  private readonly logger = new Logger(UebaService.name)

  constructor(
    private readonly repository: UebaRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST ENTITIES (paginated, tenant-scoped)                          */
  /* ---------------------------------------------------------------- */

  async listEntities(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    entityType?: string,
    riskLevel?: string,
    query?: string
  ): Promise<PaginatedEntities> {
    const where = buildEntityListWhere(tenantId, entityType, riskLevel, query)

    const [entities, total] = await Promise.all([
      this.repository.findManyEntitiesWithCount({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildEntityOrderBy(sortBy, sortOrder),
      }),
      this.repository.countEntities(where),
    ])

    const data: UebaEntityRecord[] = entities.map(e => {
      const { _count, ...rest } = e
      return {
        ...rest,
        anomalyCount: _count.anomalies,
      }
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET ENTITY BY ID                                                  */
  /* ---------------------------------------------------------------- */

  async getEntityById(id: string, tenantId: string): Promise<UebaEntityRecord> {
    const entity = await this.repository.findFirstEntityWithCount({
      where: { id, tenantId },
    })

    if (!entity) {
      this.appLogger.warn('UEBA entity not found', {
        feature: AppLogFeature.UEBA,
        action: 'getEntityById',
        className: 'UebaService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { entityId: id, tenantId },
      })
      throw new BusinessException(404, `UEBA entity ${id} not found`, 'errors.ueba.entityNotFound')
    }

    const { _count, ...rest } = entity
    return {
      ...rest,
      anomalyCount: _count.anomalies,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE ENTITY                                                     */
  /* ---------------------------------------------------------------- */

  async createEntity(tenantId: string, dto: CreateEntityDto): Promise<UebaEntityRecord> {
    const existing = await this.repository.findFirstEntityWithCount({
      where: { tenantId, entityName: dto.entityName, entityType: dto.entityType },
    })

    if (existing) {
      throw new BusinessException(
        409,
        `Entity "${dto.entityName}" of type "${dto.entityType}" already exists`,
        'errors.ueba.entityAlreadyExists'
      )
    }

    const entity = await this.repository.createEntity({
      tenant: { connect: { id: tenantId } },
      entityName: dto.entityName,
      entityType: dto.entityType,
      riskScore: dto.riskScore,
      riskLevel: dto.riskLevel,
      topAnomaly: dto.topAnomaly,
    })

    this.appLogger.info('UEBA entity created', {
      feature: AppLogFeature.UEBA,
      action: 'createEntity',
      className: 'UebaService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.SUCCESS,
      metadata: { entityId: entity.id, tenantId },
    })

    const { _count, ...rest } = entity
    return {
      ...rest,
      anomalyCount: _count.anomalies,
    }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE ENTITY                                                     */
  /* ---------------------------------------------------------------- */

  async updateEntity(
    id: string,
    tenantId: string,
    dto: UpdateEntityDto
  ): Promise<UebaEntityRecord> {
    const existing = await this.repository.findFirstEntityWithCount({
      where: { id, tenantId },
    })

    if (!existing) {
      throw new BusinessException(404, `UEBA entity ${id} not found`, 'errors.ueba.entityNotFound')
    }

    const updated = await this.repository.updateEntity({
      where: { id },
      data: dto,
    })

    this.appLogger.info('UEBA entity updated', {
      feature: AppLogFeature.UEBA,
      action: 'updateEntity',
      className: 'UebaService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.SUCCESS,
      metadata: { entityId: id, tenantId },
    })

    const { _count, ...rest } = updated
    return {
      ...rest,
      anomalyCount: _count.anomalies,
    }
  }

  /* ---------------------------------------------------------------- */
  /* DELETE ENTITY                                                     */
  /* ---------------------------------------------------------------- */

  async deleteEntity(id: string, tenantId: string): Promise<{ deleted: boolean }> {
    const existing = await this.repository.findFirstEntityWithCount({
      where: { id, tenantId },
    })

    if (!existing) {
      throw new BusinessException(404, `UEBA entity ${id} not found`, 'errors.ueba.entityNotFound')
    }

    await this.repository.deleteEntity({ id })

    this.appLogger.info('UEBA entity deleted', {
      feature: AppLogFeature.UEBA,
      action: 'deleteEntity',
      className: 'UebaService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.SUCCESS,
      metadata: { entityId: id, tenantId },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* RESOLVE ANOMALY                                                   */
  /* ---------------------------------------------------------------- */

  async resolveAnomaly(id: string, tenantId: string): Promise<UebaAnomalyRecord> {
    const existing = await this.repository.findFirstAnomaly({
      where: { id, tenantId },
    })

    if (!existing) {
      throw new BusinessException(
        404,
        `UEBA anomaly ${id} not found`,
        'errors.ueba.anomalyNotFound'
      )
    }

    const updated = await this.repository.updateAnomaly({
      where: { id },
      data: { resolved: true },
    })

    this.appLogger.info('UEBA anomaly resolved', {
      feature: AppLogFeature.UEBA,
      action: 'resolveAnomaly',
      className: 'UebaService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.SUCCESS,
      metadata: { anomalyId: id, tenantId },
    })

    const { entity, ...rest } = updated
    return {
      ...rest,
      entityName: entity.entityName,
      entityType: entity.entityType,
    }
  }

  /* ---------------------------------------------------------------- */
  /* LIST ANOMALIES (paginated, tenant-scoped)                         */
  /* ---------------------------------------------------------------- */

  async listAnomalies(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    severity?: string,
    entityId?: string,
    resolved?: boolean
  ): Promise<PaginatedAnomalies> {
    const where = buildAnomalyListWhere(tenantId, severity, entityId, resolved)

    const [anomalies, total] = await Promise.all([
      this.repository.findManyAnomaliesWithEntity({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildAnomalyOrderBy(sortBy, sortOrder),
      }),
      this.repository.countAnomalies(where),
    ])

    const data: UebaAnomalyRecord[] = anomalies.map(a => {
      const { entity, ...rest } = a
      return {
        ...rest,
        entityName: entity.entityName,
        entityType: entity.entityType,
      }
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* LIST ML MODELS (paginated, tenant-scoped)                         */
  /* ---------------------------------------------------------------- */

  async listModels(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    status?: string,
    modelType?: string
  ): Promise<PaginatedModels> {
    const where = buildModelListWhere(tenantId, status, modelType)

    const [models, total] = await Promise.all([
      this.repository.findManyModels({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildModelOrderBy(sortBy, sortOrder),
      }),
      this.repository.countModels(where),
    ])

    return {
      data: models,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getUebaStats(tenantId: string): Promise<UebaStats> {
    const twentyFourHoursAgo = new Date()
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

    const [totalEntities, criticalRiskEntities, highRiskEntities, anomalies24h, activeModels] =
      await Promise.all([
        this.repository.countEntities({ tenantId }),
        this.repository.countEntities({ tenantId, riskLevel: UebaRiskLevel.CRITICAL }),
        this.repository.countEntities({ tenantId, riskLevel: UebaRiskLevel.HIGH }),
        this.repository.countAnomalies({ tenantId, detectedAt: { gte: twentyFourHoursAgo } }),
        this.repository.countModels({ tenantId, status: MlModelStatus.ACTIVE }),
      ])

    return {
      totalEntities,
      criticalRiskEntities,
      highRiskEntities,
      anomalies24h,
      activeModels,
    }
  }
}
