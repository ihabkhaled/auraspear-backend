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
import type { AxiosRequestOptions } from '../../../common/modules/axios'
import type { TestResult, VelociraptorAuthOptions } from '../connectors.types'

/**
 * Resolves the Velociraptor base URL from config.
 * Prefers `apiUrl`, falls back to `baseUrl`.
 */
function resolveBaseUrl(config: Record<string, unknown>): string | undefined {
  return (config.apiUrl ?? config.baseUrl) as string | undefined
}

/**
 * Builds authentication options for Velociraptor requests.
 *
 * Supports two auth modes:
 * 1. **mTLS** (preferred for API port 8001) — uses `clientCert` + `clientKey`
 * 2. **Basic auth** (GUI port 8889) — uses `username` + `password`
 */
function buildAuthOptions(
  config: Record<string, unknown>,
  basicAuthFunction: (username: string, password: string) => string
): VelociraptorAuthOptions {
  const clientCert = config.clientCert as string | undefined
  const clientKey = config.clientKey as string | undefined
  const caCert = config.caCert as string | undefined
  const username = config.username as string | undefined
  const password = config.password as string | undefined

  const headers: Record<string, string> = {}
  const httpOptions: Partial<AxiosRequestOptions> = {}

  if (clientCert && clientKey) {
    // mTLS authentication for the gRPC gateway API (port 8001)
    httpOptions.clientCert = clientCert
    httpOptions.clientKey = clientKey
    if (caCert) {
      httpOptions.caCert = caCert
    }
  } else if (username && password) {
    // Basic auth for the GUI REST API (port 8889)
    headers.Authorization = basicAuthFunction(username, password)
  }

  return { headers, httpOptions }
}

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
    const baseUrl = resolveBaseUrl(config)
    if (!baseUrl) {
      return { ok: false, details: 'Velociraptor URL not configured' }
    }

    const { headers, httpOptions } = buildAuthOptions(config, (u, p) =>
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
    const baseUrl = resolveBaseUrl(config) as string
    const { headers, httpOptions } = buildAuthOptions(config, (u, p) =>
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
    const baseUrl = resolveBaseUrl(config) as string
    const { headers, httpOptions } = buildAuthOptions(config, (u, p) =>
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
