import { Injectable, Logger } from '@nestjs/common'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
  HttpMethod,
} from '../../../common/enums'
import { AxiosService } from '../../../common/modules/axios'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { extractRemoteErrorMessage, formatRemoteError } from '../connectors.utilities'
import type { TestResult } from '../connectors.types'

@Injectable()
export class GraylogService {
  private readonly logger = new Logger(GraylogService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

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
      const res = await this.httpClient.fetch(`${baseUrl}/api/system/cluster/nodes`, {
        headers: {
          Authorization: this.httpClient.basicAuth(username, password),
          'X-Requested-By': 'AuraSpear',
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('Graylog', res.status, res.data)
        this.appLogger.warn('Graylog connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'GraylogService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorType.GRAYLOG,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      const body = res.data as Record<string, unknown>
      const nodes = (body.nodes ?? body.total) as number | undefined

      this.appLogger.info('Graylog connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'GraylogService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.GRAYLOG, nodes },
      })

      return {
        ok: true,
        details: `Graylog reachable at ${baseUrl}. Nodes: ${nodes ?? 'unknown'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Graylog connection test failed: ${message}`)

      this.appLogger.error('Graylog connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'GraylogService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.GRAYLOG, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

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

    const res = await this.httpClient.fetch(`${baseUrl}/api/events/search`, {
      method: HttpMethod.POST,
      headers: {
        Authorization: this.httpClient.basicAuth(username, password),
        'X-Requested-By': 'AuraSpear',
      },
      body: filter,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Graylog events search failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'searchEvents',
        className: 'GraylogService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Graylog', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const events = (body.events ?? []) as unknown[]
    const total = (body.total_results ?? 0) as number

    this.appLogger.info('Graylog event search executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'searchEvents',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'GraylogService',
      functionName: 'searchEvents',
      metadata: { connectorType: ConnectorType.GRAYLOG, resultCount: events.length, total },
    })

    return { events, total }
  }

  /**
   * Get event definitions from Graylog.
   */
  async getEventDefinitions(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = config.baseUrl as string
    const username = config.username as string
    const password = config.password as string

    const res = await this.httpClient.fetch(`${baseUrl}/api/events/definitions`, {
      headers: {
        Authorization: this.httpClient.basicAuth(username, password),
        'X-Requested-By': 'AuraSpear',
      },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Graylog event definitions fetch failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getEventDefinitions',
        className: 'GraylogService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Graylog', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const definitions = (body.event_definitions ?? []) as unknown[]

    this.appLogger.info('Graylog event definitions retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getEventDefinitions',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'GraylogService',
      functionName: 'getEventDefinitions',
      metadata: { connectorType: ConnectorType.GRAYLOG, count: definitions.length },
    })

    return definitions
  }
}
