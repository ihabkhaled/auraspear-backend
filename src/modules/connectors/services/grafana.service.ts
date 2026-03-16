import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.utility'
import type { TestResult } from '../connectors.types'

@Injectable()
export class GrafanaService {
  private readonly logger = new Logger(GrafanaService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

  /**
   * Test Grafana connection.
   * GET /api/health (public) then GET /api/org (authenticated).
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Grafana base URL not configured' }
    }

    try {
      const headers = this.buildAuthHeaders(config)

      const res = await connectorFetch(`${baseUrl}/api/health`, {
        headers,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Grafana returned status ${res.status}` }
      }

      const health = res.data as Record<string, unknown>
      const version = (health.version ?? 'unknown') as string

      this.appLogger.info('Grafana connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'GrafanaService',
        functionName: 'testConnection',
        metadata: { connectorType: 'grafana', version },
      })

      return {
        ok: true,
        details: `Grafana v${version} reachable at ${baseUrl}. Database: ${health.database ?? 'ok'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Grafana connection test failed: ${message}`)

      this.appLogger.error('Grafana connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'GrafanaService',
        functionName: 'testConnection',
        metadata: { connectorType: 'grafana' },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Get dashboards from Grafana.
   */
  async getDashboards(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = config.baseUrl as string
    const headers = this.buildAuthHeaders(config)

    const res = await connectorFetch(`${baseUrl}/api/search?type=dash-db`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('Failed to fetch Grafana dashboards', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getDashboards',
        className: 'GrafanaService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`Failed to fetch dashboards: status ${res.status}`)
    }

    const dashboards = (res.data ?? []) as unknown[]

    this.appLogger.info('Grafana dashboards retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getDashboards',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'GrafanaService',
      functionName: 'getDashboards',
      metadata: { connectorType: 'grafana', count: dashboards.length },
    })

    return dashboards
  }

  private buildAuthHeaders(config: Record<string, unknown>): Record<string, string> {
    const apiKey = config.apiKey as string | undefined
    if (apiKey) {
      return { Authorization: `Bearer ${apiKey}` }
    }

    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      return { Authorization: basicAuth(username, password) }
    }

    return {}
  }
}
