import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { connectorFetch } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class InfluxDBService {
  private readonly logger = new Logger(InfluxDBService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

  /**
   * Test InfluxDB connection.
   * GET /ping with bearer token.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'InfluxDB base URL not configured' }
    }

    const token = config.token as string | undefined
    if (!token) {
      return { ok: false, details: 'InfluxDB token not configured' }
    }

    try {
      const res = await connectorFetch(`${baseUrl}/ping`, {
        headers: { Authorization: `Token ${token}` },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 204 && res.status !== 200) {
        return { ok: false, details: `InfluxDB returned status ${res.status}` }
      }

      const version = res.headers['x-influxdb-version'] ?? 'unknown'

      this.appLogger.info('InfluxDB connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'InfluxDBService',
        functionName: 'testConnection',
        metadata: { connectorType: 'influxdb', version },
      })

      return {
        ok: true,
        details: `InfluxDB v${version} reachable at ${baseUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`InfluxDB connection test failed: ${message}`)

      this.appLogger.error('InfluxDB connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'InfluxDBService',
        functionName: 'testConnection',
        metadata: { connectorType: 'influxdb' },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Execute a Flux query against InfluxDB.
   */
  async query(config: Record<string, unknown>, flux: string): Promise<string> {
    const baseUrl = config.baseUrl as string
    const token = config.token as string
    const org = (config.org ?? config.organization ?? '') as string

    const res = await connectorFetch(`${baseUrl}/api/v2/query?org=${encodeURIComponent(org)}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/vnd.flux',
        Accept: 'application/csv',
      },
      body: flux,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('InfluxDB Flux query failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'query',
        className: 'InfluxDBService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`InfluxDB query failed: status ${res.status}`)
    }

    this.appLogger.info('InfluxDB Flux query executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'query',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'InfluxDBService',
      functionName: 'query',
      metadata: { connectorType: 'influxdb', org },
    })

    return res.data as string
  }

  /**
   * Get buckets from InfluxDB.
   */
  async getBuckets(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = config.baseUrl as string
    const token = config.token as string

    const res = await connectorFetch(`${baseUrl}/api/v2/buckets`, {
      headers: { Authorization: `Token ${token}` },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('Failed to fetch InfluxDB buckets', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getBuckets',
        className: 'InfluxDBService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`Failed to fetch buckets: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const buckets = (body.buckets ?? []) as unknown[]

    this.appLogger.info('InfluxDB buckets retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getBuckets',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'InfluxDBService',
      functionName: 'getBuckets',
      metadata: { connectorType: 'influxdb', count: buckets.length },
    })

    return buckets
  }
}
