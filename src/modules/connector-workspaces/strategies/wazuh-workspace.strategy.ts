import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { WazuhService } from '../../connectors/services/wazuh.service'
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
export class WazuhWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(WazuhWorkspaceStrategy.name)

  constructor(private readonly wazuhService: WazuhService) {}

  async getOverview(config: Record<string, unknown>) {
    const summaryCards: WorkspaceSummaryCard[] = []
    const recentItems: WorkspaceRecentItem[] = []
    const entitiesPreview: WorkspaceEntity[] = []

    try {
      const agents = await this.wazuhService.getAgents(config)
      const activeCount = agents.length
      summaryCards.push({
        key: 'active-agents',
        label: 'Active Agents',
        value: activeCount,
        icon: 'monitor',
        variant: activeCount > 0 ? CardVariant.SUCCESS : CardVariant.WARNING,
      })

      for (const agent of agents.slice(0, 5)) {
        const a = agent as Record<string, unknown>
        entitiesPreview.push({
          id: (a.id ?? a.name ?? 'unknown') as string,
          name: (a.name ?? 'Unknown Agent') as string,
          status: (a.status ?? 'unknown') as string,
          type: 'agent',
          lastSeen: (a.lastKeepAlive ?? a.dateAdd ?? '') as string,
          metadata: {
            os: (a.os as Record<string, unknown>)?.name,
            ip: a.ip,
            version: a.version,
          },
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Wazuh agents: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'active-agents',
        label: 'Active Agents',
        value: 'N/A',
        icon: 'monitor',
        variant: CardVariant.ERROR,
      })
    }

    try {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const alertResult = await this.wazuhService.searchAlerts(config, {
        size: 10,
        sort: [{ timestamp: { order: 'desc' } }],
        query: {
          range: {
            timestamp: {
              gte: dayAgo.toISOString(),
              lte: now.toISOString(),
            },
          },
        },
      })

      summaryCards.push({
        key: 'alerts-24h',
        label: 'Alerts (24h)',
        value: alertResult.total,
        icon: 'alert-triangle',
        variant:
          alertResult.total > 100
            ? CardVariant.ERROR
            : alertResult.total > 0
              ? CardVariant.WARNING
              : CardVariant.SUCCESS,
      })

      for (const hit of alertResult.hits.slice(0, 5)) {
        const h = hit as Record<string, unknown>
        const source = (h._source ?? h) as Record<string, unknown>
        const rule = (source.rule ?? {}) as Record<string, unknown>

        recentItems.push({
          id: (h._id ?? String(Math.random())) as string,
          title: (rule.description ?? source.full_log ?? 'Alert') as string,
          description: (rule.groups as string[] | undefined)?.join(', '),
          timestamp: (source.timestamp ?? source['@timestamp'] ?? '') as string,
          severity: this.mapWazuhLevel((rule.level ?? 0) as number),
          type: 'alert',
          metadata: {
            ruleId: rule.id,
            ruleLevel: rule.level,
            agentName: (source.agent as Record<string, unknown>)?.name,
          },
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Wazuh alerts: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'alerts-24h',
        label: 'Alerts (24h)',
        value: 'N/A',
        icon: 'alert-triangle',
        variant: CardVariant.ERROR,
      })
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'refresh-agents', label: 'Refresh Agents', icon: 'refresh-cw' },
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const from = (page - 1) * pageSize
    const result = await this.wazuhService.searchAlerts(config, {
      size: pageSize,
      from,
      sort: [{ timestamp: { order: 'desc' } }],
      query: { match_all: {} },
    })

    const items: WorkspaceRecentItem[] = result.hits.map(hit => {
      const h = hit as Record<string, unknown>
      const source = (h._source ?? h) as Record<string, unknown>
      const rule = (source.rule ?? {}) as Record<string, unknown>

      return {
        id: (h._id ?? String(Math.random())) as string,
        title: (rule.description ?? source.full_log ?? 'Alert') as string,
        description: (rule.groups as string[] | undefined)?.join(', '),
        timestamp: (source.timestamp ?? source['@timestamp'] ?? '') as string,
        severity: this.mapWazuhLevel((rule.level ?? 0) as number),
        type: 'alert',
        metadata: {
          ruleId: rule.id,
          ruleLevel: rule.level,
        },
      }
    })

    return { items, total: result.total, page, pageSize }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const agents = await this.wazuhService.getAgents(config)
    const start = (page - 1) * pageSize
    const sliced = agents.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(agent => {
      const a = agent as Record<string, unknown>
      return {
        id: (a.id ?? a.name ?? 'unknown') as string,
        name: (a.name ?? 'Unknown') as string,
        status: (a.status ?? 'unknown') as string,
        type: 'agent',
        lastSeen: (a.lastKeepAlive ?? '') as string,
        metadata: {
          os: (a.os as Record<string, unknown>)?.name,
          ip: a.ip,
          version: a.version,
          group: a.group,
        },
      }
    })

    return { entities, total: agents.length, page, pageSize }
  }

  async search(
    config: Record<string, unknown>,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    const from = ((request.page ?? 1) - 1) * (request.pageSize ?? 20)

    const esQuery: Record<string, unknown> = {
      size: request.pageSize ?? 20,
      from,
      sort: [{ timestamp: { order: 'desc' } }],
      query: {
        bool: {
          must: [{ query_string: { query: request.query, default_operator: 'AND' } }],
          filter: [] as Record<string, unknown>[],
        },
      },
    }

    if (request.from ?? request.to) {
      const range: Record<string, unknown> = {}
      if (request.from) range.gte = request.from
      if (request.to) range.lte = request.to
      ;((esQuery.query as Record<string, unknown>).bool as Record<string, unknown>).filter = [
        { range: { timestamp: range } },
      ]
    }

    const result = await this.wazuhService.searchAlerts(config, esQuery)

    const results: WorkspaceRecentItem[] = result.hits.map(hit => {
      const h = hit as Record<string, unknown>
      const source = (h._source ?? h) as Record<string, unknown>
      const rule = (source.rule ?? {}) as Record<string, unknown>

      return {
        id: (h._id ?? '') as string,
        title: (rule.description ?? source.full_log ?? 'Result') as string,
        timestamp: (source.timestamp ?? '') as string,
        severity: this.mapWazuhLevel((rule.level ?? 0) as number),
        type: 'alert',
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
      case 'refresh-agents': {
        const agents = await this.wazuhService.getAgents(config)
        return {
          success: true,
          message: `Refreshed ${agents.length} agents`,
          data: { count: agents.length },
        }
      }
      case 'test-connection': {
        const result = await this.wazuhService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['refresh-agents', 'test-connection']
  }

  private mapWazuhLevel(level: number): Severity {
    if (level >= 12) return Severity.CRITICAL
    if (level >= 8) return Severity.HIGH
    if (level >= 5) return Severity.MEDIUM
    if (level >= 3) return Severity.LOW
    return Severity.INFO
  }
}
