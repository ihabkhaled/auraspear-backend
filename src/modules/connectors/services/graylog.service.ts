import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class GraylogService {
  private readonly logger = new Logger(GraylogService.name)

  /**
   * Test Graylog connection.
   * GET /api/system/cluster/nodes with basic auth + X-Requested-By header.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Graylog base URL not configured' }
    }

    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (!username || !password) {
      return { ok: false, details: 'Graylog username/password not configured' }
    }

    try {
      const res = await connectorFetch(`${baseUrl}/api/system/cluster/nodes`, {
        headers: {
          Authorization: basicAuth(username, password),
          'X-Requested-By': 'AuraSpear',
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Graylog returned status ${res.status}` }
      }

      const body = res.data as Record<string, unknown>
      const nodes = (body.nodes ?? body.total) as number | undefined

      return {
        ok: true,
        details: `Graylog reachable at ${baseUrl}. Nodes: ${nodes ?? 'unknown'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Graylog connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Search events via Graylog Events API.
   */
  async searchEvents(
    config: Record<string, unknown>,
    filter: Record<string, unknown>
  ): Promise<{ events: unknown[]; total: number }> {
    const baseUrl = config.baseUrl as string
    const username = config.username as string
    const password = config.password as string

    const res = await connectorFetch(`${baseUrl}/api/events/search`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(username, password),
        'X-Requested-By': 'AuraSpear',
      },
      body: filter,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Graylog events search failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return {
      events: (body.events ?? []) as unknown[],
      total: (body.total_results ?? 0) as number,
    }
  }

  /**
   * Get event definitions from Graylog.
   */
  async getEventDefinitions(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = config.baseUrl as string
    const username = config.username as string
    const password = config.password as string

    const res = await connectorFetch(`${baseUrl}/api/events/definitions`, {
      headers: {
        Authorization: basicAuth(username, password),
        'X-Requested-By': 'AuraSpear',
      },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Graylog event definitions failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return (body.event_definitions ?? []) as unknown[]
  }
}
