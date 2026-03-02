import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class GrafanaService {
  private readonly logger = new Logger(GrafanaService.name)

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
      })

      if (res.status !== 200) {
        return { ok: false, details: `Grafana returned status ${res.status}` }
      }

      const health = res.data as Record<string, unknown>
      const version = (health.version ?? 'unknown') as string

      return {
        ok: true,
        details: `Grafana v${version} reachable at ${baseUrl}. Database: ${health.database ?? 'ok'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Grafana connection test failed: ${message}`)
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
    })

    if (res.status !== 200) {
      throw new Error(`Failed to fetch dashboards: status ${res.status}`)
    }

    return (res.data ?? []) as unknown[]
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
