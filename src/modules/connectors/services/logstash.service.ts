import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AxiosService } from '../../../common/modules/axios'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { extractRemoteErrorMessage, formatRemoteError } from '../connectors.utilities'
import type { TestResult } from '../connectors.types'

@Injectable()
export class LogstashService {
  private readonly logger = new Logger(LogstashService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test Logstash connection via the Monitoring API.
   * GET / on the Logstash API port (default 9600) returns node info.
   * Auth is optional — Logstash API is unauthenticated by default,
   * but can be secured with basic auth via xpack.management.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Logstash base URL not configured' }
    }

    try {
      const headers: Record<string, string> = {}
      const username = config.username as string | undefined
      const password = config.password as string | undefined
      if (username && password) {
        headers.Authorization = this.httpClient.basicAuth(username, password)
      }

      const res = await this.httpClient.fetch(`${baseUrl}/`, {
        headers,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('Logstash', res.status, res.data)
        this.appLogger.warn('Logstash connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'LogstashService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: 'logstash',
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      const body = res.data as Record<string, unknown>
      const version = (body.version ?? 'unknown') as string
      const status = (body.status ?? 'unknown') as string

      this.appLogger.info('Logstash connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'LogstashService',
        functionName: 'testConnection',
        metadata: { connectorType: 'logstash', version, status },
      })

      return {
        ok: true,
        details: `Logstash reachable at ${baseUrl}. Version: ${version}. Status: ${status}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Logstash connection test failed: ${message}`)

      this.appLogger.error('Logstash connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'LogstashService',
        functionName: 'testConnection',
        metadata: { connectorType: 'logstash', error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Get pipeline stats from Logstash Monitoring API.
   * GET /_node/pipelines
   */
  async getPipelines(
    config: Record<string, unknown>
  ): Promise<{ pipelines: Record<string, unknown> }> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = this.httpClient.basicAuth(username, password)
    }

    const res = await this.httpClient.fetch(`${baseUrl}/_node/pipelines`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Logstash pipelines request failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getPipelines',
        className: 'LogstashService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Logstash', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const pipelines = (body.pipelines ?? {}) as Record<string, unknown>

    this.appLogger.info('Logstash pipelines retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getPipelines',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LogstashService',
      functionName: 'getPipelines',
      metadata: { connectorType: 'logstash', count: Object.keys(pipelines).length },
    })

    return { pipelines }
  }

  /**
   * Get pipeline stats (events in/out/filtered, queue info).
   * GET /_node/stats/pipelines
   */
  async getPipelineStats(
    config: Record<string, unknown>
  ): Promise<{ pipelines: Record<string, unknown> }> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = this.httpClient.basicAuth(username, password)
    }

    const res = await this.httpClient.fetch(`${baseUrl}/_node/stats/pipelines`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Logstash pipeline stats request failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getPipelineStats',
        className: 'LogstashService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Logstash', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const pipelines = (body.pipelines ?? {}) as Record<string, unknown>

    this.appLogger.info('Logstash pipeline stats retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getPipelineStats',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LogstashService',
      functionName: 'getPipelineStats',
      metadata: { connectorType: 'logstash', count: Object.keys(pipelines).length },
    })

    return { pipelines }
  }

  /**
   * Get hot threads from Logstash (useful for debugging performance).
   * GET /_node/hot_threads
   */
  async getHotThreads(config: Record<string, unknown>): Promise<unknown> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = this.httpClient.basicAuth(username, password)
    }

    const res = await this.httpClient.fetch(`${baseUrl}/_node/hot_threads?human=true`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Logstash hot threads request failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getHotThreads',
        className: 'LogstashService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Logstash', res.status, res.data))
    }

    this.appLogger.info('Logstash hot threads retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getHotThreads',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LogstashService',
      functionName: 'getHotThreads',
      metadata: { connectorType: 'logstash' },
    })

    return res.data
  }
}
