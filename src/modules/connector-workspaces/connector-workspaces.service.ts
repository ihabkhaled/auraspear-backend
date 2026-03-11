import { Injectable, Logger } from '@nestjs/common'
import { ConnectorWorkspaceFactoryService } from './connector-workspace-factory.service'
import { BusinessException } from '../../common/exceptions/business.exception'
import { ConnectorsService } from '../connectors/connectors.service'
import type {
  ConnectorWorkspaceOverview,
  WorkspaceRecentActivityResponse,
  WorkspaceEntitiesResponse,
  WorkspaceSearchRequest,
  WorkspaceSearchResponse,
  WorkspaceActionResponse,
} from './types/connector-workspace.types'

@Injectable()
export class ConnectorWorkspacesService {
  private readonly logger = new Logger(ConnectorWorkspacesService.name)

  constructor(
    private readonly connectorsService: ConnectorsService,
    private readonly factory: ConnectorWorkspaceFactoryService
  ) {}

  async getOverview(tenantId: string, type: string): Promise<ConnectorWorkspaceOverview> {
    const { config, connectorInfo } = await this.resolveConnector(tenantId, type)
    const strategy = this.getStrategyOrThrow(type)

    const strategyResult = await strategy.getOverview(config)

    return {
      connector: connectorInfo,
      ...strategyResult,
    }
  }

  async getRecentActivity(
    tenantId: string,
    type: string,
    page: number,
    pageSize: number
  ): Promise<WorkspaceRecentActivityResponse> {
    const { config } = await this.resolveConnector(tenantId, type)
    const strategy = this.getStrategyOrThrow(type)

    return strategy.getRecentActivity(config, page, pageSize)
  }

  async getEntities(
    tenantId: string,
    type: string,
    page: number,
    pageSize: number
  ): Promise<WorkspaceEntitiesResponse> {
    const { config } = await this.resolveConnector(tenantId, type)
    const strategy = this.getStrategyOrThrow(type)

    return strategy.getEntities(config, page, pageSize)
  }

  async search(
    tenantId: string,
    type: string,
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResponse> {
    const { config } = await this.resolveConnector(tenantId, type)
    const strategy = this.getStrategyOrThrow(type)

    return strategy.search(config, request)
  }

  async executeAction(
    tenantId: string,
    type: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<WorkspaceActionResponse> {
    const { config } = await this.resolveConnector(tenantId, type)
    const strategy = this.getStrategyOrThrow(type)

    // Validate action is in the allowlist
    const allowed = strategy.getAllowedActions()
    if (!allowed.includes(action)) {
      throw new BusinessException(
        403,
        `Action '${action}' is not allowed for connector '${type}'`,
        'errors.connectorWorkspaces.actionNotAllowed'
      )
    }

    this.logger.log(
      `Executing workspace action '${action}' for connector '${type}' in tenant '${tenantId}'`
    )

    return strategy.executeAction(config, action, params)
  }

  private async resolveConnector(
    tenantId: string,
    type: string
  ): Promise<{
    config: Record<string, unknown>
    connectorInfo: ConnectorWorkspaceOverview['connector']
  }> {
    if (!this.factory.hasStrategy(type)) {
      throw new BusinessException(
        400,
        `Unsupported connector type: ${type}`,
        'errors.connectorWorkspaces.unsupportedType'
      )
    }

    const decryptedConfig = await this.connectorsService.getDecryptedConfig(tenantId, type)

    if (!decryptedConfig) {
      throw new BusinessException(
        404,
        `Connector '${type}' is not configured or not enabled for this tenant`,
        'errors.connectorWorkspaces.notConfigured'
      )
    }

    // Get connector metadata for status info
    const connectorResponse = await this.connectorsService.findByType(tenantId, type)

    const connectorInfo: ConnectorWorkspaceOverview['connector'] = {
      type: connectorResponse.type,
      status: this.deriveStatus(connectorResponse),
      enabled: connectorResponse.enabled,
      lastTestedAt: connectorResponse.lastTestAt
        ? connectorResponse.lastTestAt.toISOString()
        : null,
      latencyMs: null,
      healthMessage: connectorResponse.lastError,
    }

    return { config: decryptedConfig, connectorInfo }
  }

  private getStrategyOrThrow(type: string) {
    const strategy = this.factory.getStrategy(type)
    if (!strategy) {
      throw new BusinessException(
        400,
        `No workspace strategy for connector type: ${type}`,
        'errors.connectorWorkspaces.unsupportedType'
      )
    }
    return strategy
  }

  private deriveStatus(connector: { lastTestOk: boolean | null; enabled: boolean }): string {
    if (!connector.enabled) return 'disabled'
    if (connector.lastTestOk === true) return 'connected'
    if (connector.lastTestOk === false) return 'disconnected'
    return 'not_tested'
  }
}
