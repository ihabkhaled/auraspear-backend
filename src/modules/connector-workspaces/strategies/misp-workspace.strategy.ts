import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { MispService } from '../../connectors/services/misp.service'
import type {
  ConnectorWorkspaceStrategy,
  WorkspaceSummaryCard,
  WorkspaceRecentItem,
  WorkspaceEntity,
  WorkspaceQuickAction,
  WorkspaceRecentActivityResponse,
  WorkspaceEntitiesResponse,
  WorkspaceSearchRequest,
  WorkspaceSearchResponse,
  WorkspaceActionResponse,
} from '../types/connector-workspace.types'

@Injectable()
export class MispWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(MispWorkspaceStrategy.name)

  constructor(private readonly mispService: MispService) {}

  async getOverview(config: Record<string, unknown>) {
    const summaryCards: WorkspaceSummaryCard[] = []
    const recentItems: WorkspaceRecentItem[] = []
    const entitiesPreview: WorkspaceEntity[] = []

    try {
      const events = await this.mispService.getEvents(config, 20)

      summaryCards.push({
        key: 'recent-events',
        label: 'Recent Events',
        value: events.length,
        icon: 'shield',
        variant: events.length > 0 ? CardVariant.INFO : CardVariant.WARNING,
      })

      const tagCounts = new Map<string, number>()

      for (const event of events.slice(0, 5)) {
        const e = (event as Record<string, unknown>).Event
          ? ((event as Record<string, unknown>).Event as Record<string, unknown>)
          : (event as Record<string, unknown>)

        recentItems.push({
          id: (e.id ?? '') as string,
          title: (e.info ?? 'MISP Event') as string,
          timestamp: (e.date ?? e.timestamp ?? '') as string,
          severity: this.mapMispThreatLevel((e.threat_level_id ?? '3') as string),
          type: 'event',
          metadata: {
            orgName: (e.Org as Record<string, unknown>)?.name ?? e.orgc_id,
            attributeCount: e.attribute_count,
          },
        })

        entitiesPreview.push({
          id: (e.id ?? '') as string,
          name: (e.info ?? 'MISP Event') as string,
          status: (e.published ? 'published' : 'draft') as string,
          type: 'event',
          metadata: {
            threatLevel: e.threat_level_id,
            analysis: e.analysis,
          },
        })

        const tags = e.Tag as Array<Record<string, unknown>> | undefined
        if (tags) {
          for (const tag of tags) {
            const name = (tag.name ?? '') as string
            tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1)
          }
        }
      }

      summaryCards.push({
        key: 'top-tags',
        label: 'Unique Tags',
        value: tagCounts.size,
        icon: 'tag',
        variant: CardVariant.DEFAULT,
      })
    } catch (error) {
      this.logger.warn(
        `Failed to fetch MISP events: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'recent-events',
        label: 'Recent Events',
        value: 'N/A',
        icon: 'shield',
        variant: CardVariant.ERROR,
      })
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
      { key: 'refresh-events', label: 'Refresh Events', icon: 'refresh-cw' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const limit = Math.min(pageSize * page, 100)
    const events = await this.mispService.getEvents(config, limit)
    const start = (page - 1) * pageSize
    const sliced = events.slice(start, start + pageSize)

    const items: WorkspaceRecentItem[] = sliced.map(event => {
      const e = (event as Record<string, unknown>).Event
        ? ((event as Record<string, unknown>).Event as Record<string, unknown>)
        : (event as Record<string, unknown>)

      return {
        id: (e.id ?? '') as string,
        title: (e.info ?? 'MISP Event') as string,
        timestamp: (e.date ?? '') as string,
        severity: this.mapMispThreatLevel((e.threat_level_id ?? '3') as string),
        type: 'event',
      }
    })

    return { items, total: events.length, page, pageSize }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const limit = Math.min(pageSize * page, 100)
    const events = await this.mispService.getEvents(config, limit)
    const start = (page - 1) * pageSize
    const sliced = events.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(event => {
      const e = (event as Record<string, unknown>).Event
        ? ((event as Record<string, unknown>).Event as Record<string, unknown>)
        : (event as Record<string, unknown>)

      return {
        id: (e.id ?? '') as string,
        name: (e.info ?? 'MISP Event') as string,
        status: (e.published ? 'published' : 'draft') as string,
        type: 'event',
        metadata: {
          threatLevel: e.threat_level_id,
          attributeCount: e.attribute_count,
        },
      }
    })

    return { entities, total: events.length, page, pageSize }
  }

  async search(
    config: Record<string, unknown>,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    const searchParameters: Record<string, unknown> = {
      value: request.query,
      type: (request.filters?.type as string) ?? undefined,
      category: (request.filters?.category as string) ?? undefined,
      limit: request.pageSize ?? 20,
      page: request.page ?? 1,
    }

    // Remove undefined values
    const cleanedParameters = Object.fromEntries(
      Object.entries(searchParameters).filter(([, v]) => v !== undefined)
    )

    if (request.from) {
      cleanedParameters.from = request.from
    }

    const attributes = await this.mispService.searchAttributes(config, cleanedParameters)

    const results: WorkspaceRecentItem[] = attributes
      .slice(0, request.pageSize ?? 20)
      .map(attribute => {
        const a = attribute as Record<string, unknown>
        return {
          id: (a.id ?? '') as string,
          title: `${a.type}: ${a.value}`,
          description: (a.comment ?? '') as string,
          timestamp: (a.timestamp ?? '') as string,
          severity: Severity.INFO,
          type: 'ioc',
          metadata: {
            category: a.category,
            toIds: a.to_ids,
            eventId: a.event_id,
          },
        }
      })

    return {
      results,
      total: attributes.length,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 20,
    }
  }

  async executeAction(
    config: Record<string, unknown>,
    action: string,
    _params: Record<string, unknown>
  ): Promise<WorkspaceActionResponse> {
    switch (action) {
      case 'test-connection': {
        const result = await this.mispService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      case 'refresh-events': {
        const events = await this.mispService.getEvents(config, 10)
        return {
          success: true,
          message: `Fetched ${events.length} events`,
          data: { count: events.length },
        }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['test-connection', 'refresh-events']
  }

  private mapMispThreatLevel(level: string): Severity {
    switch (level) {
      case '1':
        return Severity.CRITICAL
      case '2':
        return Severity.HIGH
      case '3':
        return Severity.MEDIUM
      case '4':
        return Severity.LOW
      default:
        return Severity.INFO
    }
  }
}
