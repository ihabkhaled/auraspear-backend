import { Injectable, Logger } from '@nestjs/common'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
  HttpMethod,
} from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.utility'
import type { ScrollCollectionParameters, TestResult, WazuhTokenCache } from '../connectors.types'

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
        metadata: { connectorType: ConnectorType.WAZUH, version },
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
        metadata: { connectorType: ConnectorType.WAZUH },
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
      method: HttpMethod.POST,
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
      metadata: { connectorType: ConnectorType.WAZUH },
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
      metadata: { connectorType: ConnectorType.WAZUH, count: agents.length },
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
      method: HttpMethod.POST,
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
      metadata: { connectorType: ConnectorType.WAZUH, index, resultCount: hitItems.length, total },
    })

    return { hits: hitItems, total }
  }

  /**
   * Fetch ALL matching alerts using OpenSearch scroll API.
   * Scrolls through all pages until no more hits are returned.
   * Max 10,000 events as a safety cap to prevent memory exhaustion.
   */
  async searchAllAlerts(
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

    if (!/^[\w*-]+$/.test(index)) {
      throw new Error('Invalid index name')
    }

    const authHeader = basicAuth(username as string, password as string)
    const tlsOption = config.verifyTls !== false
    const maxEvents = 10_000
    const scrollBatchSize = 1000

    // Initial search with scroll context (1 minute TTL)
    const scrollQuery = { ...query, size: scrollBatchSize }
    const initialResponse = await connectorFetch(`${indexerUrl}/${index}/_search?scroll=1m`, {
      method: HttpMethod.POST,
      headers: { Authorization: authHeader },
      body: scrollQuery,
      rejectUnauthorized: tlsOption,
      allowPrivateNetwork: true,
      timeoutMs: 30_000,
    })

    if (initialResponse.status !== 200) {
      throw new Error(`Wazuh Indexer search failed: status ${initialResponse.status}`)
    }

    const initialBody = initialResponse.data as Record<string, unknown>
    const hitsWrapper = initialBody.hits as Record<string, unknown>
    const totalObject = hitsWrapper.total as Record<string, unknown> | number
    const total = typeof totalObject === 'number' ? totalObject : (totalObject.value as number)
    let scrollId = initialBody._scroll_id as string | undefined

    const allHits: unknown[] = [...((hitsWrapper.hits ?? []) as unknown[])]

    // Scroll through remaining pages using recursion to satisfy no-await-in-loop
    scrollId = await this.collectScrollResults({
      indexerUrl,
      authHeader,
      tlsOption,
      scrollId,
      allHits,
      total,
      maxEvents,
    })

    // Clean up scroll context (fire and forget)
    if (scrollId) {
      connectorFetch(`${indexerUrl}/_search/scroll`, {
        method: HttpMethod.DELETE,
        headers: { Authorization: authHeader },
        body: { scroll_id: [scrollId] },
        rejectUnauthorized: tlsOption,
        allowPrivateNetwork: true,
      }).catch(() => {
        // Scroll cleanup is best-effort
      })
    }

    this.appLogger.info('Wazuh full alert search completed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'searchAllAlerts',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'WazuhService',
      functionName: 'searchAllAlerts',
      metadata: { connectorType: ConnectorType.WAZUH, index, resultCount: allHits.length, total },
    })

    return { hits: allHits, total }
  }

  /**
   * Recursively collect scroll results from OpenSearch.
   * Each iteration depends on the previous scroll_id, making this inherently sequential.
   * Returns the final scrollId for cleanup.
   */
  private async collectScrollResults(
    parameters: ScrollCollectionParameters
  ): Promise<string | undefined> {
    const { indexerUrl, authHeader, tlsOption, scrollId, allHits, total, maxEvents } = parameters

    if (!scrollId || allHits.length >= total || allHits.length >= maxEvents) {
      return scrollId
    }

    const scrollResponse = await connectorFetch(`${indexerUrl}/_search/scroll`, {
      method: HttpMethod.POST,
      headers: { Authorization: authHeader },
      body: { scroll: '1m', scroll_id: scrollId },
      rejectUnauthorized: tlsOption,
      allowPrivateNetwork: true,
      timeoutMs: 30_000,
    })

    if (scrollResponse.status !== 200) {
      return scrollId
    }

    const scrollBody = scrollResponse.data as Record<string, unknown>
    const scrollHits = scrollBody.hits as Record<string, unknown>
    const batch = (scrollHits.hits ?? []) as unknown[]

    if (batch.length === 0) {
      return scrollBody._scroll_id as string | undefined
    }

    allHits.push(...batch)
    const nextScrollId = scrollBody._scroll_id as string | undefined

    return this.collectScrollResults({
      indexerUrl,
      authHeader,
      tlsOption,
      scrollId: nextScrollId,
      allHits,
      total,
      maxEvents,
    })
  }
}
