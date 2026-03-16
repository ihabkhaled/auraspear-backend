import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { sanitizeEsQueryString } from '../../../common/utils/es-sanitize.utility'
import { GraylogService } from '../../connectors/services/graylog.service'
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
export class GraylogWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(GraylogWorkspaceStrategy.name)

  constructor(private readonly graylogService: GraylogService) {}

  async getOverview(config: Record<string, unknown>): Promise<{
    summaryCards: WorkspaceSummaryCard[]
    recentItems: WorkspaceRecentItem[]
    entitiesPreview: WorkspaceEntity[]
    quickActions: WorkspaceQuickAction[]
  }> {
    const summaryCards: WorkspaceSummaryCard[] = []
    const recentItems: WorkspaceRecentItem[] = []
    const entitiesPreview: WorkspaceEntity[] = []

    try {
      const eventResult = await this.graylogService.searchEvents(config, {
        timerange: { type: 'relative', range: 86400 },
        page: 1,
        per_page: 10,
      })

      summaryCards.push({
        key: 'events-24h',
        label: 'Events (24h)',
        value: eventResult.total,
        icon: 'activity',
        variant: eventResult.total > 0 ? CardVariant.INFO : CardVariant.SUCCESS,
      })

      for (const event_ of eventResult.events.slice(0, 5)) {
        const e = event_ as Record<string, unknown>
        const event = (e.event ?? e) as Record<string, unknown>

        recentItems.push({
          id: (event.id ?? String(Math.random())) as string,
          title: (event.message ?? event.key ?? 'Event') as string,
          timestamp: (event.timestamp ?? '') as string,
          severity: this.mapGraylogPriority((event.priority ?? 2) as number),
          type: 'event',
          metadata: {
            source: event.source,
            eventDefinitionId: event.event_definition_id,
          },
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Graylog events: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'events-24h',
        label: 'Events (24h)',
        value: 'N/A',
        icon: 'activity',
        variant: CardVariant.ERROR,
      })
    }

    try {
      const definitions = await this.graylogService.getEventDefinitions(config)
      summaryCards.push({
        key: 'event-definitions',
        label: 'Event Definitions',
        value: definitions.length,
        icon: 'list',
        variant: CardVariant.DEFAULT,
      })

      for (const definition of definitions.slice(0, 5)) {
        const d = definition as Record<string, unknown>
        entitiesPreview.push({
          id: (d.id ?? '') as string,
          name: (d.title ?? 'Untitled') as string,
          status: (d.state ?? 'unknown') as string,
          type: 'event-definition',
          metadata: { priority: d.priority, description: d.description },
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Graylog definitions: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const result = await this.graylogService.searchEvents(config, {
      timerange: { type: 'relative', range: 86400 },
      page,
      per_page: pageSize,
    })

    const items: WorkspaceRecentItem[] = result.events.map(event_ => {
      const e = event_ as Record<string, unknown>
      const event = (e.event ?? e) as Record<string, unknown>
      return {
        id: (event.id ?? '') as string,
        title: (event.message ?? 'Event') as string,
        timestamp: (event.timestamp ?? '') as string,
        severity: this.mapGraylogPriority((event.priority ?? 2) as number),
        type: 'event',
      }
    })

    return { items, total: result.total, page, pageSize }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const definitions = await this.graylogService.getEventDefinitions(config)
    const start = (page - 1) * pageSize
    const sliced = definitions.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(definition => {
      const d = definition as Record<string, unknown>
      return {
        id: (d.id ?? '') as string,
        name: (d.title ?? 'Untitled') as string,
        status: (d.state ?? 'unknown') as string,
        type: 'event-definition',
        metadata: { priority: d.priority },
      }
    })

    return { entities, total: definitions.length, page, pageSize }
  }

  async search(
    config: Record<string, unknown>,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    const sanitizedQuery = sanitizeEsQueryString(request.query)
    if (sanitizedQuery.length === 0) {
      return { results: [], total: 0, page: request.page ?? 1, pageSize: request.pageSize ?? 20 }
    }

    const filter: Record<string, unknown> = {
      query: sanitizedQuery,
      page: request.page ?? 1,
      per_page: request.pageSize ?? 20,
      timerange: { type: 'relative', range: 86400 },
    }

    if (request.from ?? request.to) {
      filter.timerange = {
        type: 'absolute',
        from: request.from ?? new Date(Date.now() - 86400000).toISOString(),
        to: request.to ?? new Date().toISOString(),
      }
    }

    const result = await this.graylogService.searchEvents(config, filter)

    const results: WorkspaceRecentItem[] = result.events.map(event_ => {
      const e = event_ as Record<string, unknown>
      const event = (e.event ?? e) as Record<string, unknown>
      return {
        id: (event.id ?? '') as string,
        title: (event.message ?? 'Event') as string,
        timestamp: (event.timestamp ?? '') as string,
        severity: this.mapGraylogPriority((event.priority ?? 2) as number),
        type: 'event',
      }
    })

    return {
      results,
      total: result.total,
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
        const result = await this.graylogService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['test-connection']
  }

  private mapGraylogPriority(priority: number): Severity {
    if (priority >= 4) return Severity.CRITICAL
    if (priority >= 3) return Severity.HIGH
    if (priority >= 2) return Severity.MEDIUM
    if (priority >= 1) return Severity.LOW
    return Severity.INFO
  }
}
