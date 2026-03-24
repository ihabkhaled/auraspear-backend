import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { HealthRepository } from './health.repository'
import {
  buildComponentCheckResult,
  buildFailedServiceHealthResult,
  buildOverallHealthResponse,
  buildServiceHealthResult,
  countUnhealthy,
  determineConnectorHealthStatus,
  determineOverallStatus,
  extractErrorMessage,
} from './health.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  HealthStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { ConnectorsService } from '../connectors/connectors.service'
import type { ServiceHealthResult, OverallHealth, ComponentCheck } from './health.types'

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)
  private readonly redis: Redis

  constructor(
    private readonly repository: HealthRepository,
    private readonly configService: ConfigService,
    private readonly connectorsService: ConnectorsService,
    private readonly appLogger: AppLoggerService
  ) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost')
    const port = this.configService.get<number>('REDIS_PORT', 6379)
    const password = this.configService.get<string>('REDIS_PASSWORD', '')

    this.redis = new Redis({
      host,
      port,
      password: password || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })

    this.redis.on('error', () => {
      // Suppress connection errors — checked in health check
    })
  }

  async getOverallHealthOrThrow(): Promise<OverallHealth> {
    const health = await this.getOverallHealth()

    if (health.status === HealthStatus.DOWN) {
      throw new BusinessException(503, 'System is down', 'errors.health.serviceUnavailable')
    }

    return health
  }

  async getOverallHealth(): Promise<OverallHealth> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()])
    const status = determineOverallStatus(database, redis)

    this.logOverallHealth(status, database, redis)

    return buildOverallHealthResponse(status, database, redis)
  }

  async getAllServiceHealth(tenantId: string): Promise<ServiceHealthResult[]> {
    const connectors = await this.connectorsService.getEnabledConnectors(tenantId)

    const results = await Promise.all(
      connectors.map(async connector => this.checkConnectorHealth(tenantId, connector))
    )

    this.logServiceHealthResults(tenantId, connectors.length, results)

    return results
  }

  private async checkConnectorHealth(
    tenantId: string,
    connector: { name: string; type: string }
  ): Promise<ServiceHealthResult> {
    try {
      const test = await this.connectorsService.testConnection(tenantId, connector.type)
      const status = determineConnectorHealthStatus(test.ok, test.latencyMs)
      return buildServiceHealthResult(connector.name, connector.type, status, test.latencyMs)
    } catch (error) {
      const message = extractErrorMessage(error)
      this.logger.error(`Health check failed for connector ${connector.type}: ${message}`)
      this.logConnectorHealthFailure(tenantId, connector, message)
      return buildFailedServiceHealthResult(connector.name, connector.type)
    }
  }

  private async checkDatabase(): Promise<ComponentCheck> {
    const start = Date.now()
    try {
      await this.repository.pingDatabase()
      return buildComponentCheckResult(HealthStatus.HEALTHY, Date.now() - start)
    } catch (error) {
      const message = extractErrorMessage(error)
      this.logger.error(`Database health check failed: ${message}`)
      this.logComponentCheckFailure('checkDatabase', message)
      return buildComponentCheckResult(HealthStatus.DOWN, Date.now() - start)
    }
  }

  private async checkRedis(): Promise<ComponentCheck> {
    const start = Date.now()
    try {
      await this.redis.ping()
      return buildComponentCheckResult(HealthStatus.HEALTHY, Date.now() - start)
    } catch (error) {
      const message = extractErrorMessage(error)
      this.logger.error(`Redis health check failed: ${message}`)
      this.logComponentCheckFailure('checkRedis', message)
      return buildComponentCheckResult(HealthStatus.DOWN, Date.now() - start)
    }
  }

  private logOverallHealth(
    status: HealthStatus,
    database: ComponentCheck,
    redis: ComponentCheck
  ): void {
    this.appLogger.debug('Overall health check completed', {
      feature: AppLogFeature.SYSTEM,
      action: 'getOverallHealth',
      outcome: status === HealthStatus.HEALTHY ? AppLogOutcome.SUCCESS : AppLogOutcome.WARNING,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HealthService',
      functionName: 'getOverallHealth',
      metadata: {
        status,
        databaseStatus: database.status,
        databaseLatencyMs: database.latencyMs,
        redisStatus: redis.status,
        redisLatencyMs: redis.latencyMs,
      },
    })
  }

  private logConnectorHealthFailure(
    tenantId: string,
    connector: { name: string; type: string },
    errorMessage: string
  ): void {
    this.appLogger.error(`Health check failed for connector ${connector.type}`, {
      feature: AppLogFeature.SYSTEM,
      action: 'getAllServiceHealth',
      className: 'HealthService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      metadata: {
        connectorType: connector.type,
        connectorName: connector.name,
        error: errorMessage,
      },
    })
  }

  private logComponentCheckFailure(action: string, errorMessage: string): void {
    this.appLogger.error(`${action} health check failed`, {
      feature: AppLogFeature.SYSTEM,
      action,
      className: 'HealthService',
      sourceType: AppLogSourceType.SERVICE,
      outcome: AppLogOutcome.FAILURE,
      metadata: { error: errorMessage },
    })
  }

  private logServiceHealthResults(
    tenantId: string,
    totalConnectors: number,
    results: ServiceHealthResult[]
  ): void {
    const unhealthyCount = countUnhealthy(results)

    this.appLogger.debug('Service health check completed for all connectors', {
      feature: AppLogFeature.SYSTEM,
      action: 'getAllServiceHealth',
      outcome: unhealthyCount === 0 ? AppLogOutcome.SUCCESS : AppLogOutcome.WARNING,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HealthService',
      functionName: 'getAllServiceHealth',
      metadata: {
        totalConnectors,
        unhealthyCount,
      },
    })
  }
}
