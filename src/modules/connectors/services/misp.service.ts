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
export class MispService {
  private readonly logger = new Logger(MispService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test MISP connection.
   * GET /servers/getPyMISPVersion.json with Authorization header.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'MISP URL not configured' }
    }

    // authKey is the canonical key; mispAuthKey and apiKey are legacy fallbacks
    const authKey = (config.authKey ?? config.mispAuthKey ?? config.apiKey) as string | undefined
    if (!authKey) {
      return { ok: false, details: 'MISP auth key not configured' }
    }

    try {
      const res = await this.httpClient.fetch(`${baseUrl}/servers/getPyMISPVersion.json`, {
        headers: {
          Authorization: authKey,
          Accept: 'application/json',
        },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('MISP', res.status, res.data)
        this.appLogger.warn('MISP connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'MispService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorType.MISP,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      const body = res.data as Record<string, unknown>
      const version = body.version as string | undefined

      this.appLogger.info('MISP connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'MispService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.MISP, version: version ?? 'unknown' },
      })

      return {
        ok: true,
        details: `MISP reachable at ${baseUrl}. PyMISP version: ${version ?? 'unknown'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`MISP connection test failed: ${message}`)

      this.appLogger.error('MISP connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'MispService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.MISP, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Get recent events from MISP.
   */
  async getEvents(config: Record<string, unknown>, limit: number = 20): Promise<unknown[]> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    // authKey is the canonical key; mispAuthKey and apiKey are legacy fallbacks
    const authKey = (config.authKey ?? config.mispAuthKey ?? config.apiKey) as string

    const res = await this.httpClient.fetch(
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
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('MISP events fetch failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getEvents',
        className: 'MispService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, limit, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('MISP', res.status, res.data))
    }

    const events = (res.data ?? []) as unknown[]

    this.appLogger.info('MISP events retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getEvents',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'MispService',
      functionName: 'getEvents',
      metadata: { connectorType: ConnectorType.MISP, limit, count: events.length },
    })

    return events
  }

  /**
   * Search attributes (IOCs) in MISP.
   */
  async searchAttributes(
    config: Record<string, unknown>,
    searchParameters: Record<string, unknown>
  ): Promise<unknown[]> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    // authKey is the canonical key; mispAuthKey and apiKey are legacy fallbacks
    const authKey = (config.authKey ?? config.mispAuthKey ?? config.apiKey) as string

    const res = await this.httpClient.fetch(`${baseUrl}/attributes/restSearch`, {
      method: HttpMethod.POST,
      headers: {
        Authorization: authKey,
        Accept: 'application/json',
      },
      body: searchParameters,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('MISP attribute search failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'searchAttributes',
        className: 'MispService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('MISP', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const response = body.response as Record<string, unknown> | undefined
    const attribute = response?.Attribute as unknown[] | undefined
    const results = attribute ?? []

    this.appLogger.info('MISP attribute search executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'searchAttributes',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'MispService',
      functionName: 'searchAttributes',
      metadata: { connectorType: ConnectorType.MISP, resultCount: results.length },
    })

    return results
  }

  /**
   * Get a single MISP event by ID.
   */
  async getEvent(config: Record<string, unknown>, eventId: string): Promise<unknown> {
    const baseUrl = (config.mispUrl ?? config.baseUrl) as string
    // authKey is the canonical key; mispAuthKey and apiKey are legacy fallbacks
    const authKey = (config.authKey ?? config.mispAuthKey ?? config.apiKey) as string

    // Validate eventId to prevent path traversal
    if (!/^\d+$/.test(eventId)) {
      this.appLogger.warn('Invalid MISP event ID provided', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getEvent',
        className: 'MispService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { eventId },
      })
      throw new Error('Invalid MISP event ID')
    }

    const res = await this.httpClient.fetch(`${baseUrl}/events/view/${eventId}`, {
      headers: {
        Authorization: authKey,
        Accept: 'application/json',
      },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('MISP event fetch failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getEvent',
        className: 'MispService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, eventId, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('MISP', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>

    this.appLogger.info('MISP event retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getEvent',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'MispService',
      functionName: 'getEvent',
      metadata: { connectorType: ConnectorType.MISP, eventId },
    })

    return body.Event ?? body
  }
}
