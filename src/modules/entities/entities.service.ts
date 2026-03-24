import { Injectable, Logger } from '@nestjs/common'
import { EntitiesRepository } from './entities.repository'
import {
  buildEntitySearchWhere,
  buildEntityOrderBy,
  collectConnectedIds,
  collectSecondHopData,
  deduplicateRelations,
  buildGraphResponse,
} from './entities.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreateEntityDto } from './dto/create-entity.dto'
import type { ListEntitiesQueryDto } from './dto/list-entities-query.dto'
import type { UpdateEntityDto } from './dto/update-entity.dto'
import type { EntityRecord, EntityGraphResponse, PaginatedEntities } from './entities.types'
import type { InputJsonValue } from '@prisma/client/runtime/library'

@Injectable()
export class EntitiesService {
  private readonly logger = new Logger(EntitiesService.name)

  constructor(
    private readonly entitiesRepository: EntitiesRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async list(tenantId: string, query: ListEntitiesQueryDto): Promise<PaginatedEntities> {
    const where = buildEntitySearchWhere(tenantId, query)

    const [data, total] = await this.entitiesRepository.findManyAndCount({
      where,
      orderBy: buildEntityOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    })

    this.logSuccess('list', tenantId, { page: query.page, limit: query.limit, total })

    return { data, pagination: buildPaginationMeta(query.page, query.limit, total) }
  }

  async findById(tenantId: string, id: string): Promise<EntityRecord> {
    const entity = await this.entitiesRepository.findFirstByIdAndTenant(id, tenantId)

    if (!entity) {
      this.logWarn('findById', tenantId, id)
      throw new BusinessException(404, 'Entity not found', 'errors.entities.notFound')
    }

    return entity
  }

  async create(tenantId: string, dto: CreateEntityDto): Promise<EntityRecord> {
    const existing = await this.entitiesRepository.findByTypeAndValue(tenantId, dto.type, dto.value)

    if (existing) {
      throw new BusinessException(409, 'Entity already exists', 'errors.entities.alreadyExists')
    }

    const entity = await this.entitiesRepository.create({
      tenant: { connect: { id: tenantId } },
      type: dto.type,
      value: dto.value,
      displayName: dto.displayName,
      metadata: (dto.metadata ?? {}) as InputJsonValue,
    })

    this.logSuccess('create', tenantId, { entityId: entity.id, type: dto.type })

    return entity
  }

  async update(tenantId: string, id: string, dto: UpdateEntityDto): Promise<EntityRecord> {
    await this.findById(tenantId, id)

    const updated = await this.entitiesRepository.updateByIdAndTenant(id, tenantId, {
      displayName: dto.displayName,
      metadata: dto.metadata as InputJsonValue | undefined,
    })

    if (!updated) {
      throw new BusinessException(404, 'Entity not found after update', 'errors.entities.notFound')
    }

    this.logSuccess('update', tenantId, { entityId: id })

    return updated
  }

  async getGraph(tenantId: string, entityId: string): Promise<EntityGraphResponse> {
    const rootEntity = await this.findById(tenantId, entityId)

    const directRelations = await this.entitiesRepository.findRelationsForEntity(entityId, tenantId)
    const connectedIds = collectConnectedIds(directRelations, entityId)

    const secondHopResults = await Promise.all(
      [...connectedIds].map(connId =>
        this.entitiesRepository.findRelationsForEntity(connId, tenantId)
      )
    )

    const { secondHopRelations, secondHopIds } = collectSecondHopData(secondHopResults)
    const allEntityIds = new Set([entityId, ...connectedIds, ...secondHopIds])
    const allRelations = [...directRelations, ...secondHopRelations]
    const uniqueRelations = deduplicateRelations(allRelations)

    const entities = await this.entitiesRepository.findConnectedEntities(
      [...allEntityIds],
      tenantId
    )

    return buildGraphResponse(rootEntity, entities, uniqueRelations)
  }

  async getTopRisky(tenantId: string, limit = 10): Promise<EntityRecord[]> {
    return this.entitiesRepository.findTopRisky(tenantId, limit)
  }

  private logSuccess(action: string, tenantId: string, metadata?: Record<string, unknown>): void {
    this.appLogger.info(`Entity action: ${action}`, {
      feature: AppLogFeature.ENTITIES,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'EntitiesService',
      functionName: action,
      metadata,
    })
  }

  private logWarn(action: string, tenantId: string, resourceId?: string): void {
    this.appLogger.warn(`Entity action failed: ${action}`, {
      feature: AppLogFeature.ENTITIES,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      targetResource: 'Entity',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'EntitiesService',
      functionName: action,
    })
  }
}
