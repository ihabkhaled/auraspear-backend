import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { LogstashService } from '../../connectors/services/logstash.service'
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
export class LogstashWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(LogstashWorkspaceStrategy.name)

  constructor(private readonly logstashService: LogstashService) {}

  async getOverview(config: Record<string, unknown>) {
    const summaryCards: WorkspaceSummaryCard[] = []
    const recentItems: WorkspaceRecentItem[] = []
    const entitiesPreview: WorkspaceEntity[] = []

    try {
      const { pipelines } = await this.logstashService.getPipelines(config)
      const pipelineNames = Object.keys(pipelines)

      summaryCards.push({
        key: 'pipelines',
        label: 'Pipelines',
        value: pipelineNames.length,
        icon: 'git-branch',
        variant: pipelineNames.length > 0 ? CardVariant.SUCCESS : CardVariant.WARNING,
      })

      for (const name of pipelineNames.slice(0, 5)) {
        const pipeline = pipelines[name] as Record<string, unknown> | undefined
        entitiesPreview.push({
          id: name,
          name,
          status: 'active',
          type: 'pipeline',
          metadata: {
            workers: pipeline?.workers,
            batchSize: pipeline?.batch_size,
          },
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Logstash pipelines: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'pipelines',
        label: 'Pipelines',
        value: 'N/A',
        icon: 'git-branch',
        variant: CardVariant.ERROR,
      })
    }

    try {
      const { pipelines: stats } = await this.logstashService.getPipelineStats(config)

      let totalEventsIn = 0
      let totalEventsOut = 0
      let totalEventsFiltered = 0

      for (const name of Object.keys(stats)) {
        const stat = stats[name] as Record<string, unknown> | undefined
        const events = stat?.events as Record<string, unknown> | undefined

        const eventIn = (events?.in ?? 0) as number
        const eventOut = (events?.out ?? 0) as number
        const eventFiltered = (events?.filtered ?? 0) as number

        totalEventsIn += eventIn
        totalEventsOut += eventOut
        totalEventsFiltered += eventFiltered

        recentItems.push({
          id: name,
          title: `Pipeline: ${name}`,
          description: `In: ${eventIn} | Out: ${eventOut} | Filtered: ${eventFiltered}`,
          timestamp: new Date().toISOString(),
          severity: Severity.INFO,
          type: 'pipeline-stats',
          metadata: { eventsIn: eventIn, eventsOut: eventOut, eventsFiltered: eventFiltered },
        })
      }

      summaryCards.push({
        key: 'events-in',
        label: 'Events In (total)',
        value: totalEventsIn,
        icon: 'arrow-down',
        variant: CardVariant.INFO,
      })

      summaryCards.push({
        key: 'events-out',
        label: 'Events Out (total)',
        value: totalEventsOut,
        icon: 'arrow-up',
        variant: CardVariant.INFO,
      })

      const dropped = totalEventsIn - totalEventsOut - totalEventsFiltered
      summaryCards.push({
        key: 'events-dropped',
        label: 'Events Dropped (est.)',
        value: Math.max(0, dropped),
        icon: 'alert-circle',
        variant: dropped > 0 ? CardVariant.WARNING : CardVariant.SUCCESS,
      })
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Logstash stats: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'refresh-stats', label: 'Refresh Stats', icon: 'refresh-cw' },
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const { pipelines: stats } = await this.logstashService.getPipelineStats(config)
    const allItems: WorkspaceRecentItem[] = []

    for (const name of Object.keys(stats)) {
      const stat = stats[name] as Record<string, unknown> | undefined
      const events = stat?.events as Record<string, unknown> | undefined

      allItems.push({
        id: name,
        title: `Pipeline: ${name}`,
        description: `In: ${events?.in ?? 0} | Out: ${events?.out ?? 0}`,
        timestamp: new Date().toISOString(),
        severity: Severity.INFO,
        type: 'pipeline-stats',
      })
    }

    const start = (page - 1) * pageSize
    return {
      items: allItems.slice(start, start + pageSize),
      total: allItems.length,
      page,
      pageSize,
    }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const { pipelines } = await this.logstashService.getPipelines(config)
    const names = Object.keys(pipelines)
    const start = (page - 1) * pageSize
    const sliced = names.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(name => {
      const pipeline = pipelines[name] as Record<string, unknown> | undefined
      return {
        id: name,
        name,
        status: 'active',
        type: 'pipeline',
        metadata: {
          workers: pipeline?.workers,
          batchSize: pipeline?.batch_size,
          batchDelay: pipeline?.batch_delay,
        },
      }
    })

    return { entities, total: names.length, page, pageSize }
  }

  async search(
    _config: Record<string, unknown>,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    // Logstash doesn't support arbitrary search — return empty
    return { results: [], total: 0, page: request.page ?? 1, pageSize: request.pageSize ?? 20 }
  }

  async executeAction(
    config: Record<string, unknown>,
    action: string,
    _params: Record<string, unknown>
  ): Promise<WorkspaceActionResponse> {
    switch (action) {
      case 'refresh-stats': {
        const { pipelines } = await this.logstashService.getPipelineStats(config)
        const count = Object.keys(pipelines).length
        return { success: true, message: `Refreshed stats for ${count} pipelines`, data: { count } }
      }
      case 'test-connection': {
        const result = await this.logstashService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['refresh-stats', 'test-connection']
  }
}
