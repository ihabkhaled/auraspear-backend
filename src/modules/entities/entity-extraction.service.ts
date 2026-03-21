import { Injectable, Logger } from '@nestjs/common'
import { EntitiesRepository } from './entities.repository'
import { EntityRelationType, EntityType } from '../../common/enums'
import type { AlertExtractionInput, ExtractedEntity } from './entities.types'

@Injectable()
export class EntityExtractionService {
  private readonly logger = new Logger(EntityExtractionService.name)

  constructor(private readonly entitiesRepository: EntitiesRepository) {}

  /**
   * Extract entities from an alert and upsert them into the entities table.
   * Called after alert creation/ingestion. Best-effort — errors are logged, not thrown.
   */
  async extractFromAlert(alert: AlertExtractionInput): Promise<void> {
    try {
      const entities = this.buildEntityList(alert)

      // Upsert each entity (sequential to avoid race conditions on same entity)
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

      // Create relationships between extracted entities
      await this.createAlertRelationships(alert.tenantId, entities, alert.source)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(`Entity extraction failed for alert ${alert.id}: ${errorMessage}`)
    }
  }

  private buildEntityList(alert: AlertExtractionInput): ExtractedEntity[] {
    const entities: ExtractedEntity[] = []

    if (alert.sourceIp) {
      entities.push({ type: EntityType.IP, value: alert.sourceIp })
    }

    if (alert.destinationIp) {
      entities.push({ type: EntityType.IP, value: alert.destinationIp })
    }

    if (alert.agentName) {
      entities.push({
        type: EntityType.HOSTNAME,
        value: alert.agentName,
        displayName: alert.agentName,
      })
    }

    const rawEvent = alert.rawEvent as Record<string, unknown> | null
    if (rawEvent) {
      const user = this.extractUserFromRawEvent(rawEvent)
      if (user) {
        entities.push({ type: EntityType.USER, value: user })
      }

      const domain = this.extractDomainFromRawEvent(rawEvent)
      if (domain) {
        entities.push({ type: EntityType.DOMAIN, value: domain })
      }
    }

    return entities
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

  private extractUserFromRawEvent(rawEvent: Record<string, unknown>): string | null {
    const data = rawEvent['data'] as Record<string, unknown> | undefined
    if (data) {
      const srcuser = data['srcuser']
      if (typeof srcuser === 'string' && srcuser.length > 0) {
        return srcuser
      }

      const dstuser = data['dstuser']
      if (typeof dstuser === 'string' && dstuser.length > 0) {
        return dstuser
      }

      const win = data['win'] as Record<string, unknown> | undefined
      const eventdata = win?.['eventdata'] as Record<string, unknown> | undefined
      const targetUserName = eventdata?.['TargetUserName']
      if (typeof targetUserName === 'string' && targetUserName.length > 0) {
        return targetUserName
      }

      const user = data['user']
      if (typeof user === 'string' && user.length > 0) {
        return user
      }
    }

    return null
  }

  private extractDomainFromRawEvent(rawEvent: Record<string, unknown>): string | null {
    const data = rawEvent['data'] as Record<string, unknown> | undefined
    if (data) {
      const hostname = data['hostname']
      if (typeof hostname === 'string' && hostname.includes('.')) {
        return hostname
      }

      const query = data['query']
      if (typeof query === 'string' && query.includes('.')) {
        return query
      }

      const dns = data['dns'] as Record<string, unknown> | undefined
      const question = dns?.['question'] as Record<string, unknown> | undefined
      const name = question?.['name']
      if (typeof name === 'string' && name.includes('.')) {
        return name
      }
    }

    return null
  }

  private async createAlertRelationships(
    tenantId: string,
    entities: ExtractedEntity[],
    source: string
  ): Promise<void> {
    const ips = entities.filter(e => e.type === EntityType.IP)
    const sourceIp = ips.at(0)
    const destinationIp = ips.at(1)

    if (!sourceIp || !destinationIp || sourceIp.value === destinationIp.value) {
      return
    }

    try {
      const fromEntity = await this.entitiesRepository.findByTypeAndValue(
        tenantId,
        sourceIp.type,
        sourceIp.value
      )
      const toEntity = await this.entitiesRepository.findByTypeAndValue(
        tenantId,
        destinationIp.type,
        destinationIp.value
      )

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
