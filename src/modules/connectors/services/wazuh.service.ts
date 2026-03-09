import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

interface WazuhTokenCache {
  token: string
  expiresAt: number
}

@Injectable()
export class WazuhService {
  private readonly logger = new Logger(WazuhService.name)
  private readonly tokenCache = new Map<string, WazuhTokenCache>()

  /**
   * Test Wazuh Manager connection.
   * Authenticates via POST /security/user/authenticate (basic auth).
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const managerUrl = (config.managerUrl ?? config.baseUrl) as string | undefined
    if (!managerUrl) {
      return { ok: false, details: 'Wazuh Manager URL not configured' }
    }

    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (!username || !password) {
      return { ok: false, details: 'Wazuh Manager username/password not configured' }
    }

    try {
      const token = await this.authenticate(managerUrl, username, password, config)

      // Verify token by getting manager info
      const infoResponse = await connectorFetch(`${managerUrl}/manager/info`, {
        headers: { Authorization: `Bearer ${token}` },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (infoResponse.status !== 200) {
        return { ok: false, details: `Wazuh Manager returned status ${infoResponse.status}` }
      }

      const info = infoResponse.data as Record<string, unknown>
      const data = (info.data as Record<string, unknown>) ?? info
      const version = (data.api_version ?? data.version ?? 'unknown') as string

      return {
        ok: true,
        details: `Wazuh Manager v${version} reachable at ${managerUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Wazuh connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Authenticate with Wazuh Manager and return JWT token.
   * Caches token for 10 minutes.
   */
  async authenticate(
    managerUrl: string,
    username: string,
    password: string,
    config: Record<string, unknown> = {}
  ): Promise<string> {
    const cacheKey = `${managerUrl}:${username}`
    const cached = this.tokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }

    const res = await connectorFetch(`${managerUrl}/security/user/authenticate`, {
      method: 'POST',
      headers: { Authorization: basicAuth(username, password) },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Wazuh authentication failed with status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const data = body.data as Record<string, unknown> | undefined
    const token = (data?.token ?? body.token) as string

    if (!token) {
      throw new Error('Wazuh authentication returned no token')
    }

    // Cache for 10 minutes
    this.tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    })

    return token
  }

  /**
   * Get agents from Wazuh Manager.
   */
  async getAgents(config: Record<string, unknown>): Promise<unknown[]> {
    const managerUrl = (config.managerUrl ?? config.baseUrl) as string
    const token = await this.authenticate(
      managerUrl,
      config.username as string,
      config.password as string,
      config
    )

    const res = await connectorFetch(`${managerUrl}/agents?status=active&limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Failed to fetch agents: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const data = body.data as Record<string, unknown> | undefined
    return (data?.affected_items ?? []) as unknown[]
  }

  /**
   * Search alerts from Wazuh Indexer via Elasticsearch DSL.
   */
  async searchAlerts(
    config: Record<string, unknown>,
    query: Record<string, unknown>,
    index: string = 'wazuh-alerts-*'
  ): Promise<{ hits: unknown[]; total: number }> {
    const indexerUrl = (config.indexerUrl ?? config.opensearchUrl) as string | undefined
    if (!indexerUrl) {
      throw new Error('Wazuh Indexer URL not configured')
    }

    const username = config.indexerUsername ?? config.username
    const password = config.indexerPassword ?? config.password

    // Validate index name to prevent path traversal
    if (!/^[\w*-]+$/.test(index)) {
      throw new Error('Invalid index name')
    }

    const res = await connectorFetch(`${indexerUrl}/${index}/_search`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(username as string, password as string),
      },
      body: query,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Wazuh Indexer search failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const hits = body.hits as Record<string, unknown>
    const totalObject = hits.total as Record<string, unknown> | number
    const total = typeof totalObject === 'number' ? totalObject : (totalObject.value as number)

    return {
      hits: (hits.hits ?? []) as unknown[],
      total,
    }
  }
}
