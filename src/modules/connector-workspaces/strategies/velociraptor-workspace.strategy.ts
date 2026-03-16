import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { VelociraptorService } from '../../connectors/services/velociraptor.service'
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
export class VelociraptorWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(VelociraptorWorkspaceStrategy.name)

  constructor(private readonly velociraptorService: VelociraptorService) {}

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
      const clients = await this.velociraptorService.getClients(config)
      const onlineCount = clients.filter(c => {
        const cl = c as Record<string, unknown>
        return cl.last_seen_at && Date.now() - Number(cl.last_seen_at) < 300_000_000
      }).length

      summaryCards.push(
        {
          key: 'total-clients',
          label: 'Total Clients',
          value: clients.length,
          icon: 'laptop',
          variant: CardVariant.INFO,
        },
        {
          key: 'online-clients',
          label: 'Online Clients',
          value: onlineCount,
          icon: 'wifi',
          variant: onlineCount > 0 ? CardVariant.SUCCESS : CardVariant.WARNING,
        }
      )

      for (const client of clients.slice(0, 5)) {
        const cl = client as Record<string, unknown>
        const info = (cl.os_info ?? {}) as Record<string, unknown>

        entitiesPreview.push({
          id: (cl.client_id ?? '') as string,
          name: (info.fqdn ?? info.hostname ?? cl.client_id ?? 'Unknown') as string,
          status: cl.last_seen_at ? 'seen' : 'unknown',
          type: 'client',
          lastSeen: cl.last_seen_at
            ? new Date(Number(cl.last_seen_at) / 1000).toISOString()
            : undefined,
          metadata: { os: info.system, release: info.release, clientId: cl.client_id },
        })

        recentItems.push({
          id: (cl.client_id ?? '') as string,
          title: `Client: ${(info.fqdn ?? info.hostname ?? cl.client_id) as string}`,
          timestamp: cl.last_seen_at ? new Date(Number(cl.last_seen_at) / 1000).toISOString() : '',
          severity: Severity.INFO,
          type: 'client-activity',
        })
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Velociraptor clients: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'total-clients',
        label: 'Total Clients',
        value: 'N/A',
        icon: 'laptop',
        variant: CardVariant.ERROR,
      })
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
      { key: 'refresh-clients', label: 'Refresh Clients', icon: 'refresh-cw' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const clients = await this.velociraptorService.getClients(config)
    const sorted = [...clients].sort((a, b) => {
      const aTime = Number((a as Record<string, unknown>).last_seen_at ?? 0)
      const bTime = Number((b as Record<string, unknown>).last_seen_at ?? 0)
      return bTime - aTime
    })
    const start = (page - 1) * pageSize
    const sliced = sorted.slice(start, start + pageSize)

    const items: WorkspaceRecentItem[] = sliced.map(client => {
      const cl = client as Record<string, unknown>
      const info = (cl.os_info ?? {}) as Record<string, unknown>
      return {
        id: (cl.client_id ?? '') as string,
        title: `Client: ${(info.fqdn ?? info.hostname ?? cl.client_id) as string}`,
        timestamp: cl.last_seen_at ? new Date(Number(cl.last_seen_at) / 1000).toISOString() : '',
        severity: Severity.INFO,
        type: 'client-activity',
      }
    })

    return { items, total: clients.length, page, pageSize }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const clients = await this.velociraptorService.getClients(config)
    const start = (page - 1) * pageSize
    const sliced = clients.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(client => {
      const cl = client as Record<string, unknown>
      const info = (cl.os_info ?? {}) as Record<string, unknown>
      return {
        id: (cl.client_id ?? '') as string,
        name: (info.fqdn ?? info.hostname ?? cl.client_id ?? 'Unknown') as string,
        status: cl.last_seen_at ? 'seen' : 'unknown',
        type: 'client',
        lastSeen: cl.last_seen_at
          ? new Date(Number(cl.last_seen_at) / 1000).toISOString()
          : undefined,
        metadata: { os: info.system, clientId: cl.client_id },
      }
    })

    return { entities, total: clients.length, page, pageSize }
  }

  async search(
    _config: Record<string, unknown>,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    return { results: [], total: 0, page: request.page ?? 1, pageSize: request.pageSize ?? 20 }
  }

  async executeAction(
    config: Record<string, unknown>,
    action: string,
    _params: Record<string, unknown>
  ): Promise<WorkspaceActionResponse> {
    switch (action) {
      case 'test-connection': {
        const result = await this.velociraptorService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      case 'refresh-clients': {
        const clients = await this.velociraptorService.getClients(config)
        return {
          success: true,
          message: `Found ${clients.length} clients`,
          data: { count: clients.length },
        }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['test-connection', 'refresh-clients']
  }
}
