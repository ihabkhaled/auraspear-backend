import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, HttpMethod } from '../../../common/enums'
import { AxiosService } from '../../../common/modules/axios'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { ConnectorServiceName } from '../connectors.enums'
import { extractRemoteErrorMessage, formatRemoteError } from '../connectors.utilities'
import type { TestResult } from '../connectors.types'

/**
 * Generic OpenSearch / Elasticsearch service.
 * Used by WazuhService for Wazuh Indexer queries and as a fallback.
 */
@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

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
        headers.Authorization = this.httpClient.basicAuth(username, password)
      }

      const res = await this.httpClient.fetch(`${baseUrl}/_cluster/health`, {
        headers,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('OpenSearch', res.status, res.data)
        this.appLogger.warn('OpenSearch connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'OpenSearchService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorServiceName.OPENSEARCH,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
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
          connectorType: ConnectorServiceName.OPENSEARCH,
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
        metadata: { connectorType: ConnectorServiceName.OPENSEARCH, error: message },
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
      headers.Authorization = this.httpClient.basicAuth(username, password)
    }

    const res = await this.httpClient.fetch(`${baseUrl}/${index}/_search`, {
      method: HttpMethod.POST,
      headers,
      body: query,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('OpenSearch search failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'search',
        className: 'OpenSearchService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, index, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('OpenSearch', res.status, res.data))
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
      metadata: {
        connectorType: ConnectorServiceName.OPENSEARCH,
        index,
        resultCount: hitItems.length,
        total,
      },
    })

    return { hits: hitItems, total }
  }
}
