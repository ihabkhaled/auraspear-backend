import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class MispService {
  private readonly logger = new Logger(MispService.name)

  /**
   * Test MISP connection.
   * GET /servers/getPyMISPVersion.json with Authorization header.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'MISP URL not configured' }
    }

    const authKey = (config.authKey ?? config.apiKey) as string | undefined
    if (!authKey) {
      return { ok: false, details: 'MISP auth key not configured' }
    }

    try {
      const res = await connectorFetch(`${baseUrl}/servers/getPyMISPVersion.json`, {
        headers: {
          Authorization: authKey,
          Accept: 'application/json',
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `MISP returned status ${res.status}` }
      }

      const body = res.data as Record<string, unknown>
      const version = body.version as string | undefined

      return {
        ok: true,
        details: `MISP reachable at ${baseUrl}. PyMISP version: ${version ?? 'unknown'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`MISP connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Get recent events from MISP.
   */
  async getEvents(config: Record<string, unknown>, limit: number = 20): Promise<unknown[]> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    const authKey = (config.authKey ?? config.apiKey) as string

    const res = await connectorFetch(
      `${baseUrl}/events/index?limit=${limit}&sort=date&direction=desc`,
      {
        headers: {
          Authorization: authKey,
          Accept: 'application/json',
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      }
    )

    if (res.status !== 200) {
      throw new Error(`MISP events fetch failed: status ${res.status}`)
    }

    return (res.data ?? []) as unknown[]
  }

  /**
   * Search attributes (IOCs) in MISP.
   */
  async searchAttributes(
    config: Record<string, unknown>,
    searchParameters: Record<string, unknown>
  ): Promise<unknown[]> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    const authKey = (config.authKey ?? config.apiKey) as string

    const res = await connectorFetch(`${baseUrl}/attributes/restSearch`, {
      method: 'POST',
      headers: {
        Authorization: authKey,
        Accept: 'application/json',
      },
      body: searchParameters,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`MISP attribute search failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const response = body.response as Record<string, unknown> | undefined
    const attribute = response?.Attribute as unknown[] | undefined
    return attribute ?? []
  }

  /**
   * Get a single MISP event by ID.
   */
  async getEvent(config: Record<string, unknown>, eventId: string): Promise<unknown> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    const authKey = (config.authKey ?? config.apiKey) as string

    // Validate eventId to prevent path traversal
    if (!/^\d+$/.test(eventId)) {
      throw new Error('Invalid MISP event ID')
    }

    const res = await connectorFetch(`${baseUrl}/events/view/${eventId}`, {
      headers: {
        Authorization: authKey,
        Accept: 'application/json',
      },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`MISP event fetch failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return body.Event ?? body
  }
}
