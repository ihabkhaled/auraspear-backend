import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
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

  constructor(private readonly appLogger: AppLoggerService) {}

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

      this.appLogger.info('Wazuh connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'WazuhService',
        functionName: 'testConnection',
        metadata: { connectorType: 'wazuh', version },
      })

      return {
        ok: true,
        details: `Wazuh Manager v${version} reachable at ${managerUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Wazuh connection test failed: ${message}`)

      this.appLogger.error('Wazuh connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'WazuhService',
        functionName: 'testConnection',
        metadata: { connectorType: 'wazuh' },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

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
      this.appLogger.warn('Wazuh authentication failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'authenticate',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`Wazuh authentication failed with status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const data = body.data as Record<string, unknown> | undefined
    const token = (data?.token ?? body.token) as string

    if (!token) {
      this.appLogger.warn('Wazuh authentication returned no token', {
        feature: AppLogFeature.CONNECTORS,
        action: 'authenticate',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {},
      })
      throw new Error('Wazuh authentication returned no token')
    }

    // Cache for 10 minutes
    this.tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    })

    this.appLogger.info('Wazuh authentication succeeded', {
      feature: AppLogFeature.CONNECTORS,
      action: 'authenticate',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'WazuhService',
      functionName: 'authenticate',
      metadata: { connectorType: 'wazuh' },
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
      this.appLogger.warn('Failed to fetch Wazuh agents', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getAgents',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`Failed to fetch agents: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const data = body.data as Record<string, unknown> | undefined
    const agents = (data?.affected_items ?? []) as unknown[]

    this.appLogger.info('Wazuh agents retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getAgents',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'WazuhService',
      functionName: 'getAgents',
      metadata: { connectorType: 'wazuh', count: agents.length },
    })

    return agents
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
      this.appLogger.warn('Wazuh Indexer URL not configured', {
        feature: AppLogFeature.CONNECTORS,
        action: 'searchAlerts',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {},
      })
      throw new Error('Wazuh Indexer URL not configured')
    }

    const username = config.indexerUsername ?? config.username
    const password = config.indexerPassword ?? config.password

    // Validate index name to prevent path traversal
    if (!/^[\w*-]+$/.test(index)) {
      this.appLogger.warn('Invalid Wazuh index name provided', {
        feature: AppLogFeature.CONNECTORS,
        action: 'searchAlerts',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { index },
      })
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
      this.appLogger.warn('Wazuh Indexer search failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'searchAlerts',
        className: 'WazuhService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, index },
      })
      throw new Error(`Wazuh Indexer search failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const hits = body.hits as Record<string, unknown>
    const totalObject = hits.total as Record<string, unknown> | number
    const total = typeof totalObject === 'number' ? totalObject : (totalObject.value as number)

    const hitItems = (hits.hits ?? []) as unknown[]

    this.appLogger.info('Wazuh alert search executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'searchAlerts',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'WazuhService',
      functionName: 'searchAlerts',
      metadata: { connectorType: 'wazuh', index, resultCount: hitItems.length, total },
    })

    return { hits: hitItems, total }
  }
}
