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
import {
  buildVelociraptorAuthOptions,
  extractRemoteErrorMessage,
  formatRemoteError,
  resolveVelociraptorBaseUrl,
} from '../connectors.utilities'
import type { TestResult } from '../connectors.types'

@Injectable()
export class VelociraptorService {
  private readonly logger = new Logger(VelociraptorService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test Velociraptor connection.
   * Supports mTLS (clientCert + clientKey) or Basic auth (username + password).
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = resolveVelociraptorBaseUrl(config)
    if (!baseUrl) {
      return { ok: false, details: 'Velociraptor URL not configured' }
    }

    const { headers, httpOptions } = buildVelociraptorAuthOptions(config, (u, p) =>
      this.httpClient.basicAuth(u, p)
    )

    const hasClientCert = Boolean(config.clientCert && config.clientKey)
    const hasBasicAuth = Boolean(config.username && config.password)

    if (!hasClientCert && !hasBasicAuth) {
      return {
        ok: false,
        details:
          'Velociraptor authentication not configured. Provide client certificate + key (mTLS) or username + password (Basic auth).',
      }
    }

    try {
      const res = await this.httpClient.fetch(`${baseUrl}/api/v1/GetUserUITraits`, {
        headers,
        ...httpOptions,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('Velociraptor', res.status, res.data)
        this.appLogger.warn('Velociraptor connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'VelociraptorService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorType.VELOCIRAPTOR,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      this.appLogger.info('Velociraptor connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VelociraptorService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.VELOCIRAPTOR },
      })

      return {
        ok: true,
        details: `Velociraptor server reachable at ${baseUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Velociraptor connection test failed: ${message}`)

      this.appLogger.error('Velociraptor connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VelociraptorService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.VELOCIRAPTOR, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

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
    const baseUrl = resolveVelociraptorBaseUrl(config) as string
    const { headers, httpOptions } = buildVelociraptorAuthOptions(config, (u, p) =>
      this.httpClient.basicAuth(u, p)
    )

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/CreateNotebook`, {
      method: HttpMethod.POST,
      headers,
      ...httpOptions,
      body: { query: vql },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Velociraptor VQL query failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'runVQL',
        className: 'VelociraptorService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Velociraptor', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const rows = (body.rows ?? []) as unknown[]
    const columns = (body.columns ?? []) as string[]

    this.appLogger.info('Velociraptor VQL query executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'runVQL',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VelociraptorService',
      functionName: 'runVQL',
      metadata: {
        connectorType: ConnectorType.VELOCIRAPTOR,
        rowCount: rows.length,
        columnCount: columns.length,
      },
    })

    return { rows, columns }
  }

  /**
   * Get connected clients from Velociraptor.
   */
  async getClients(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = resolveVelociraptorBaseUrl(config) as string
    const { headers, httpOptions } = buildVelociraptorAuthOptions(config, (u, p) =>
      this.httpClient.basicAuth(u, p)
    )

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/SearchClients?query=all&limit=500`, {
      headers,
      ...httpOptions,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Failed to fetch Velociraptor clients', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getClients',
        className: 'VelociraptorService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Velociraptor', res.status, res.data))
    }

    const body = res.data as Record<string, unknown>
    const clients = (body.items ?? []) as unknown[]

    this.appLogger.info('Velociraptor clients retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getClients',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VelociraptorService',
      functionName: 'getClients',
      metadata: { connectorType: ConnectorType.VELOCIRAPTOR, count: clients.length },
    })

    return clients
  }
}
