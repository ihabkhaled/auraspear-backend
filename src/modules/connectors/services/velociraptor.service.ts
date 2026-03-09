import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class VelociraptorService {
  private readonly logger = new Logger(VelociraptorService.name)

  /**
   * Test Velociraptor connection via API key auth.
   * GET /api/v1/GetServerMetadata
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Velociraptor base URL not configured' }
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      return { ok: false, details: 'Velociraptor API key not configured' }
    }

    try {
      const res = await connectorFetch(`${baseUrl}/api/v1/GetServerMetadata`, {
        headers: {
          'Grpc-Metadata-authorization': `Bearer ${apiKey}`,
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Velociraptor returned status ${res.status}` }
      }

      return {
        ok: true,
        details: `Velociraptor server reachable at ${baseUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Velociraptor connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Execute a VQL query against Velociraptor.
   */
  async runVQL(
    config: Record<string, unknown>,
    vql: string
  ): Promise<{ rows: unknown[]; columns: string[] }> {
    const baseUrl = config.baseUrl as string
    const apiKey = config.apiKey as string

    const res = await connectorFetch(`${baseUrl}/api/v1/CreateNotebook`, {
      method: 'POST',
      headers: {
        'Grpc-Metadata-authorization': `Bearer ${apiKey}`,
      },
      body: { query: vql },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`VQL query failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return {
      rows: (body.rows ?? []) as unknown[],
      columns: (body.columns ?? []) as string[],
    }
  }

  /**
   * Get connected clients from Velociraptor.
   */
  async getClients(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = config.baseUrl as string
    const apiKey = config.apiKey as string

    const res = await connectorFetch(`${baseUrl}/api/v1/SearchClients?query=all&limit=500`, {
      headers: {
        'Grpc-Metadata-authorization': `Bearer ${apiKey}`,
      },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Failed to fetch clients: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return (body.items ?? []) as unknown[]
  }
}
