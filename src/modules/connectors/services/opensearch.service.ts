import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.utility'
import type { TestResult } from '../connectors.types'

/**
 * Generic OpenSearch / Elasticsearch service.
 * Used by WazuhService for Wazuh Indexer queries and as a fallback.
 */
@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

  /**
   * Test OpenSearch cluster health.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'OpenSearch base URL not configured' }
    }

    const username = config.username as string | undefined
    const password = config.password as string | undefined

    try {
      const headers: Record<string, string> = {}
      if (username && password) {
        headers.Authorization = basicAuth(username, password)
      }

      const res = await connectorFetch(`${baseUrl}/_cluster/health`, {
        headers,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `OpenSearch returned status ${res.status}` }
      }

      const health = res.data as Record<string, unknown>

      this.appLogger.info('OpenSearch connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OpenSearchService',
        functionName: 'testConnection',
        metadata: {
          connectorType: 'opensearch',
          clusterName: health.cluster_name,
          clusterStatus: health.status,
        },
      })

      return {
        ok: true,
        details: `OpenSearch cluster "${health.cluster_name}" status: ${health.status}. Nodes: ${health.number_of_nodes}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`OpenSearch connection test failed: ${message}`)

      this.appLogger.error('OpenSearch connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OpenSearchService',
        functionName: 'testConnection',
        metadata: { connectorType: 'opensearch' },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Execute an Elasticsearch DSL search query.
   */
  async search(
    config: Record<string, unknown>,
    index: string,
    query: Record<string, unknown>
  ): Promise<{ hits: unknown[]; total: number }> {
    const baseUrl = config.baseUrl as string
    const username = config.username as string | undefined
    const password = config.password as string | undefined

    const headers: Record<string, string> = {}
    if (username && password) {
      headers.Authorization = basicAuth(username, password)
    }

    const res = await connectorFetch(`${baseUrl}/${index}/_search`, {
      method: 'POST',
      headers,
      body: query,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('OpenSearch search failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'search',
        className: 'OpenSearchService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, index },
      })
      throw new Error(`OpenSearch search failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const hits = body.hits as Record<string, unknown>
    const totalObject = hits.total as Record<string, unknown> | number
    const total = typeof totalObject === 'number' ? totalObject : (totalObject.value as number)

    const hitItems = (hits.hits ?? []) as unknown[]

    this.appLogger.info('OpenSearch search executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'search',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OpenSearchService',
      functionName: 'search',
      metadata: { connectorType: 'opensearch', index, resultCount: hitItems.length, total },
    })

    return { hits: hitItems, total }
  }
}
