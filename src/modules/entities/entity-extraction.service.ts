import { Injectable, Logger } from '@nestjs/common'
import { EntitiesRepository } from './entities.repository'
import {
  buildEntityListFromAlert,
  mapMispIocTypeToEntityType,
} from './entities.utilities'
import { CaseArtifactType, EntityRelationType, EntityType } from '../../common/enums'
import type {
  AlertExtractionInput,
  ArtifactExtractionInput,
  ExtractedEntity,
  MispIocExtractionInput,
} from './entities.types'

@Injectable()
export class EntityExtractionService {
  private readonly logger = new Logger(EntityExtractionService.name)

  constructor(private readonly entitiesRepository: EntitiesRepository) {}

  async extractFromAlert(alert: AlertExtractionInput): Promise<void> {
    try {
      const entities = buildEntityListFromAlert(alert)

      const results = await Promise.allSettled(
        entities.map(entity => this.upsertEntity(alert.tenantId, entity))
      )

      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `Entity upsert failed during extraction: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`
          )
        }
      }

      await this.createAlertRelationships(alert.tenantId, entities, alert.source)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(`Entity extraction failed for alert ${alert.id}: ${errorMessage}`)
    }
  }

  async extractFromArtifact(params: ArtifactExtractionInput): Promise<void> {
    try {
      const entityType = this.resolveArtifactEntityType(params.type)
      if (!entityType) return

      await this.upsertEntity(params.tenantId, { type: entityType, value: params.value })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(
        `Entity extraction failed for artifact ${params.type}:${params.value}: ${errorMessage}`
      )
    }
  }

  async extractFromMispIoc(params: MispIocExtractionInput): Promise<void> {
    try {
      const entityType = mapMispIocTypeToEntityType(params.iocType)
      if (!entityType) return

      await this.upsertEntity(params.tenantId, { type: entityType, value: params.iocValue })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(
        `Entity extraction failed for MISP IOC ${params.iocType}:${params.iocValue}: ${errorMessage}`
      )
    }
  }

  private resolveArtifactEntityType(artifactType: string): EntityType | null {
    switch (artifactType) {
      case CaseArtifactType.IP:
        return EntityType.IP
      case CaseArtifactType.DOMAIN:
        return EntityType.DOMAIN
      case CaseArtifactType.URL:
        return EntityType.URL
      case CaseArtifactType.HASH:
        return EntityType.HASH
      default:
        return null
    }
  }

  private async upsertEntity(tenantId: string, entity: ExtractedEntity): Promise<void> {
    try {
      await this.entitiesRepository.upsertByTypeAndValue(tenantId, entity.type, entity.value, {
        displayName: entity.displayName,
        lastSeen: new Date(),
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(`Failed to upsert entity ${entity.type}:${entity.value} — ${errorMessage}`)
    }
  }

  private async createAlertRelationships(
    tenantId: string,
    entities: ExtractedEntity[],
    source: string
  ): Promise<void> {
    const ips = entities.filter(e => e.type === EntityType.IP)
    const sourceIp = ips.at(0)
    const destinationIp = ips.at(1)

    if (!sourceIp || !destinationIp || sourceIp.value === destinationIp.value) return

    try {
      const [fromEntity, toEntity] = await Promise.all([
        this.entitiesRepository.findByTypeAndValue(tenantId, sourceIp.type, sourceIp.value),
        this.entitiesRepository.findByTypeAndValue(tenantId, destinationIp.type, destinationIp.value),
      ])

      if (fromEntity && toEntity) {
        await this.entitiesRepository.createRelation({
          tenant: { connect: { id: tenantId } },
          fromEntity: { connect: { id: fromEntity.id } },
          toEntity: { connect: { id: toEntity.id } },
          relationType: EntityRelationType.COMMUNICATES_WITH,
          source,
        })
      }
    } catch {
      // Duplicate relation is acceptable — silently ignore
    }
  }
}
