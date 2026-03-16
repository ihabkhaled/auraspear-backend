import { Injectable, Logger } from '@nestjs/common'
import { CardVariant, Severity } from '../../../common/enums'
import { ShuffleService } from '../../connectors/services/shuffle.service'
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
export class ShuffleWorkspaceStrategy implements ConnectorWorkspaceStrategy {
  private readonly logger = new Logger(ShuffleWorkspaceStrategy.name)

  constructor(private readonly shuffleService: ShuffleService) {}

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
      const workflows = await this.shuffleService.getWorkflows(config)

      summaryCards.push({
        key: 'workflows',
        label: 'Workflows',
        value: workflows.length,
        icon: 'workflow',
        variant: workflows.length > 0 ? CardVariant.SUCCESS : CardVariant.WARNING,
      })

      let activeCount = 0
      for (const wf of workflows.slice(0, 10)) {
        const w = wf as Record<string, unknown>
        if (w.is_valid) activeCount++

        if (entitiesPreview.length < 5) {
          entitiesPreview.push({
            id: (w.id ?? '') as string,
            name: (w.name ?? 'Untitled') as string,
            status: w.is_valid ? 'active' : 'inactive',
            type: 'workflow',
            metadata: {
              actions: (w.actions as unknown[])?.length ?? 0,
              triggers: (w.triggers as unknown[])?.length ?? 0,
            },
          })
        }

        if (recentItems.length < 5) {
          recentItems.push({
            id: (w.id ?? '') as string,
            title: (w.name ?? 'Workflow') as string,
            description: w.is_valid ? 'Active' : 'Inactive',
            timestamp: (w.edited ?? w.created ?? '') as string,
            severity: w.is_valid ? Severity.INFO : Severity.LOW,
            type: 'workflow',
          })
        }
      }

      summaryCards.push({
        key: 'active-workflows',
        label: 'Active Workflows',
        value: activeCount,
        icon: 'check-circle',
        variant: activeCount > 0 ? CardVariant.SUCCESS : CardVariant.WARNING,
      })
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Shuffle workflows: ${error instanceof Error ? error.message : 'unknown'}`
      )
      summaryCards.push({
        key: 'workflows',
        label: 'Workflows',
        value: 'N/A',
        icon: 'workflow',
        variant: CardVariant.ERROR,
      })
    }

    const quickActions: WorkspaceQuickAction[] = [
      { key: 'test-connection', label: 'Test Connection', icon: 'play' },
      { key: 'refresh-workflows', label: 'Refresh Workflows', icon: 'refresh-cw' },
    ]

    return { summaryCards, recentItems, entitiesPreview, quickActions }
  }

  async getRecentActivity(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const workflows = await this.shuffleService.getWorkflows(config)
    const start = (page - 1) * pageSize
    const sliced = workflows.slice(start, start + pageSize)

    const items: WorkspaceRecentItem[] = sliced.map(wf => {
      const w = wf as Record<string, unknown>
      return {
        id: (w.id ?? '') as string,
        title: (w.name ?? 'Workflow') as string,
        timestamp: (w.edited ?? '') as string,
        severity: Severity.INFO,
        type: 'workflow',
      }
    })

    return { items, total: workflows.length, page, pageSize }
  }

  async getEntities(
    config: Record<string, unknown>,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const workflows = await this.shuffleService.getWorkflows(config)
    const start = (page - 1) * pageSize
    const sliced = workflows.slice(start, start + pageSize)

    const entities: WorkspaceEntity[] = sliced.map(wf => {
      const w = wf as Record<string, unknown>
      return {
        id: (w.id ?? '') as string,
        name: (w.name ?? 'Untitled') as string,
        status: w.is_valid ? 'active' : 'inactive',
        type: 'workflow',
        metadata: { actions: (w.actions as unknown[])?.length ?? 0 },
      }
    })

    return { entities, total: workflows.length, page, pageSize }
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
    params: Record<string, unknown>
  ): Promise<WorkspaceActionResponse> {
    switch (action) {
      case 'test-connection': {
        const result = await this.shuffleService.testConnection(config)
        return { success: result.ok, message: result.details }
      }
      case 'refresh-workflows': {
        const workflows = await this.shuffleService.getWorkflows(config)
        return {
          success: true,
          message: `Found ${workflows.length} workflows`,
          data: { count: workflows.length },
        }
      }
      case 'execute-workflow': {
        const workflowId = params.workflowId as string | undefined
        if (!workflowId) {
          return { success: false, message: 'workflowId is required' }
        }
        const result = await this.shuffleService.executeWorkflow(
          config,
          workflowId,
          (params.data as Record<string, unknown>) ?? {}
        )
        return {
          success: true,
          message: `Workflow executed: ${result.executionId}`,
          data: { executionId: result.executionId },
        }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }

  getAllowedActions(): string[] {
    return ['test-connection', 'refresh-workflows', 'execute-workflow']
  }
}
